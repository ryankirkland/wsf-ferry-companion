"""Stats materializer (M4 D3): Athena -> static JSON contracts.

Chained by the transform's async invoke on success, with a late-morning
catch-up cron behind it - ordering by causality, not by hoping a clock
offset is long enough (ADR-0005: nobody waits on Athena at request time).

Every published number carries its window and its n. Where a scheduled
slot has too few sailings to say anything (n < 30 in the primary window),
the slot degrades to its hour bucket and SAYS it degraded rather than
printing a confident percentage built on four departures.
"""

import json
import os
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import boto3
from wsf_core.slips import RETIRED_TERMINAL_NAMES

from wsf_analytics import queries, reconcile
from wsf_analytics.athena import Athena
from wsf_analytics.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
STATS_PREFIX = "data/stats/"
CACHE_CONTROL = "public, max-age=300"
COVERAGE_LOOKBACK_DAYS = 14
MIN_VESSEL_SAMPLE = 200  # superlatives need a real season behind them
MIN_PAIR_SAMPLE = 100


def _stat(row: dict, suffix: str) -> dict:
    n = row.get(f"n_{suffix}") or 0
    if not n:
        return {"n": 0, "ontime_pct": None, "p50": None, "p90": None}
    return {
        "n": n,
        "ontime_pct": row.get(f"ontime_{suffix}"),
        "p50": row.get(f"p50_{suffix}"),
        "p90": row.get(f"p90_{suffix}"),
    }


def _pair_directory(s3, data_bucket: str) -> dict[tuple[int, int], dict]:
    body = s3.get_object(Bucket=data_bucket, Key="data/pairs/index.json")["Body"].read()
    return {(p["dep"], p["arr"]): p for p in json.loads(body)["pairs"]}


def _terminal_label(directory: dict, terminal_id: int, position: str) -> str:
    for (dep, arr), pair in directory.items():
        if position == "dep" and dep == terminal_id:
            return pair["dep_name"]
        if position == "arr" and arr == terminal_id:
            return pair["arr_name"]
    return RETIRED_TERMINAL_NAMES.get(terminal_id, f"Terminal {terminal_id}")


def _publish(s3, bucket: str, key: str, doc: dict) -> None:
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(doc, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl=CACHE_CONTROL,
    )


def _best(rows: list[dict], suffix: str, minimum: int, reverse: bool):
    eligible = [
        r
        for r in rows
        if (r.get(f"n_{suffix}") or 0) >= minimum and r.get(f"ontime_{suffix}") is not None
    ]
    if not eligible:
        return None
    return sorted(eligible, key=lambda r: r[f"ontime_{suffix}"], reverse=reverse)[0]


def lambda_handler(event, context):
    data_bucket = os.environ["DATA_BUCKET"]
    raw_bucket = os.environ["RAW_BUCKET"]
    s3 = boto3.client("s3")
    athena = Athena(
        database=os.environ.get("GLUE_DATABASE", "wsf_prod_analytics"),
        workgroup=os.environ.get("ATHENA_WORKGROUP", "wsf-prod-analytics"),
    )

    (bounds,) = athena.query(queries.data_bounds())
    if not bounds.get("through"):
        emit(StatsNoData=1)
        raise RuntimeError("history table returned no rows - refusing to publish empty stats")

    through = date.fromisoformat(bounds["through"])
    cutoff = (through - timedelta(days=queries.PRIMARY_WINDOW_DAYS - 1)).isoformat()
    window = {
        "label": f"last {queries.PRIMARY_WINDOW_DAYS} days",
        "from": cutoff,
        "to": through.isoformat(),
    }

    slot_rows = athena.query(queries.slots(cutoff))
    hour_rows = athena.query(queries.hours(cutoff))
    pair_rows = athena.query(queries.pairs(cutoff))
    season_rows = athena.query(queries.seasons())
    system_rows = athena.query(queries.system(cutoff))
    vessel_rows = athena.query(queries.vessels(cutoff))
    month_rows = athena.query(queries.months())
    day_rows = athena.query(
        queries.recent_days((through - timedelta(days=COVERAGE_LOOKBACK_DAYS - 1)).isoformat())
    )

    days = reconcile.window_days(through)
    cancellations = {
        "totals": {
            "scheduled": 0,
            "not_sailed": 0,
            "days": 0,
            "unreconciled_days": 0,
            "rate_pct": None,
        },
        "pairs": {},
    }
    if days:
        sailed = athena.query(queries.sailed_slots(days[0].isoformat()))
        scheduled = reconcile.scheduled_by_pair_day(s3, raw_bucket, days)
        cancellations = reconcile.reconcile(scheduled, sailed)

    directory = _pair_directory(s3, data_bucket)
    generated_at = datetime.now(UTC).isoformat()
    cancel_note = (
        "A scheduled sailing that never departed. Measured by comparing each day's published "
        "schedule with the sailings the fleet actually reported, so sailings cancelled early "
        "enough to be pulled from the schedule are not counted - treat this as a floor."
    )
    cancel_meta = {
        "tracking_since": reconcile.TRACKING_FLOOR.isoformat(),
        "window": {"from": days[0].isoformat(), "to": days[-1].isoformat()} if days else None,
        "note": cancel_note,
    }

    hour_by_key = {(r["dep"], r["arr"], r["hh"]): r for r in hour_rows}
    seasons_by_pair: dict[tuple[int, int], list] = {}
    for row in season_rows:
        seasons_by_pair.setdefault((row["dep"], row["arr"]), []).append(
            {"season": row["season"], "n": row["n"], "ontime_pct": row["ontime"], "p90": row["p90"]}
        )

    slots_by_pair: dict[tuple[int, int], list] = {}
    degraded = 0
    for row in slot_rows:
        key = (row["dep"], row["arr"])
        slot_window = _stat(row, "win")
        primary = slot_window
        basis = "slot"
        if slot_window["n"] < queries.MIN_SLOT_SAMPLE:
            # A weekend-only sailing lands here honestly: ~26 departures in
            # 90 days is under the floor, so we lead with the hour bucket
            # and keep the slot's own thin numbers beside it rather than
            # dropping them.
            bucket_row = hour_by_key.get((row["dep"], row["arr"], row["hhmm"][:2]))
            if bucket_row:
                primary = _stat(bucket_row, "win")
                basis = "hour"
                degraded += 1
        slots_by_pair.setdefault(key, []).append(
            {
                "hhmm": row["hhmm"],
                "basis": basis,
                "primary": primary,
                "slot_window": slot_window,
                "all_time": _stat(row, "all"),
            }
        )

    written = 0
    for row in pair_rows:
        key = (row["dep"], row["arr"])
        pair = directory.get(key)
        if pair is None:
            continue  # retired pairs stay in the system rollup, not on a page
        doc = {
            "v": 1,
            "generated_at": generated_at,
            "data_through": through.isoformat(),
            "window": window,
            "pair": {
                "dep": key[0],
                "arr": key[1],
                "dep_name": pair["dep_name"],
                "arr_name": pair["arr_name"],
                "slug": pair["slug"],
            },
            "ontime_definition_min": queries.ONTIME_MIN,
            "min_slot_sample": queries.MIN_SLOT_SAMPLE,
            "overall": {"primary": _stat(row, "win"), "all_time": _stat(row, "all")},
            "slots": sorted(slots_by_pair.get(key, []), key=lambda s: s["hhmm"]),
            "seasons": seasons_by_pair.get(key, []),
            "cancellations": {**cancel_meta, **cancellations["pairs"].get(key, {})},
        }
        _publish(s3, data_bucket, f"{STATS_PREFIX}pairs/{key[0]}-{key[1]}.json", doc)
        written += 1

    overall = next((r for r in system_rows if r.get("year") is None), {})
    by_year = [
        {"year": r["year"], "n": r["n_all"], "ontime_pct": r["ontime_all"], "p90": r["p90_all"]}
        for r in system_rows
        if r.get("year") is not None
    ]
    day_counts = sorted(r["n"] for r in day_rows)
    median_day = day_counts[len(day_counts) // 2] if day_counts else 0
    thin_days = [
        {"service_date": r["service_date"], "n": r["n"], "vessels": r["vessels"]}
        for r in day_rows
        if median_day and r["n"] < median_day * 0.5
    ]

    punctual_vessel = _best(vessel_rows, "win", MIN_VESSEL_SAMPLE, reverse=True) or _best(
        vessel_rows, "all", MIN_VESSEL_SAMPLE, reverse=True
    )
    roughest_month = min(month_rows, key=lambda r: r["ontime"]) if month_rows else None
    best_pair = _best(pair_rows, "win", MIN_PAIR_SAMPLE, reverse=True)
    worst_pair = _best(pair_rows, "win", MIN_PAIR_SAMPLE, reverse=False)

    def pair_label(row) -> dict | None:
        if row is None:
            return None
        key = (row["dep"], row["arr"])
        pair = directory.get(key)
        return {
            "dep": key[0],
            "arr": key[1],
            "name": (
                f"{pair['dep_name']} to {pair['arr_name']}"
                if pair
                else f"{_terminal_label(directory, key[0], 'dep')} to "
                f"{_terminal_label(directory, key[1], 'arr')}"
            ),
            "slug": pair["slug"] if pair else None,
            "ontime_pct": row["ontime_win"],
            "n": row["n_win"],
        }

    summary = {
        "v": 1,
        "generated_at": generated_at,
        "data_through": through.isoformat(),
        "window": window,
        "ontime_definition_min": queries.ONTIME_MIN,
        "coverage": {
            "since": bounds["since"],
            "through": through.isoformat(),
            "sailings": bounds["rows_total"],
            "vessels": bounds["vessels"],
            "pairs_published": written,
            "note": (
                "Every departure the fleet reported since "
                f"{bounds['since']}. On-time means a departure within "
                f"{queries.ONTIME_MIN} minutes of schedule; sailings that never departed are "
                "counted under cancellations, not as late departures."
            ),
            "thin_days": thin_days,
            "thin_days_note": (
                "Days whose reported sailings fell below half the recent median - a collection "
                "gap rather than a quiet day. Shown so they are not mistaken for signal."
            ),
        },
        "system": {"primary": _stat(overall, "win"), "all_time": _stat(overall, "all")},
        "by_year": by_year,
        "by_month": [
            {"month": r["month"], "n": r["n"], "ontime_pct": r["ontime"], "p90": r["p90"]}
            for r in month_rows
        ],
        "superlatives": {
            "most_punctual_vessel": (
                {
                    "vessel_name": punctual_vessel["vessel_name"],
                    "ontime_pct": punctual_vessel.get("ontime_win")
                    or punctual_vessel["ontime_all"],
                    "n": punctual_vessel.get("n_win") or punctual_vessel["n_all"],
                }
                if punctual_vessel
                else None
            ),
            "roughest_month": (
                {
                    "month": roughest_month["month"],
                    "ontime_pct": roughest_month["ontime"],
                    "n": roughest_month["n"],
                }
                if roughest_month
                else None
            ),
            "most_punctual_pair": pair_label(best_pair),
            "toughest_pair": pair_label(worst_pair),
        },
        "vessels": [
            {
                "vessel_name": r["vessel_name"],
                "primary": _stat(r, "win"),
                "all_time": _stat(r, "all"),
            }
            for r in vessel_rows
        ],
        "cancellations": {**cancel_meta, **cancellations["totals"]},
    }
    _publish(s3, data_bucket, f"{STATS_PREFIX}summary.json", summary)

    lag_days = (datetime.now(SOUND_TZ).date() - through).days
    counts = {
        "StatsPublished": 1,
        "StatsPairsWritten": written,
        "StatsSlotsDegraded": degraded,
        "StatsDataLagDays": lag_days,
        "StatsBytesScanned": athena.bytes_scanned,
    }
    if thin_days:
        counts["StatsThinDays"] = len(thin_days)
    emit(**counts)
    print(
        json.dumps(
            {
                "Stats": {
                    **counts,
                    "data_through": through.isoformat(),
                    "trigger": (event or {}).get("trigger", "manual"),
                }
            }
        )
    )
    return counts
