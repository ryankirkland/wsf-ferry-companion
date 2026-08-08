"""Schedule/fares refresher Lambda: materializes the M2 trip contracts.

rate(15 minutes), timeout 840 s < 900 s spacing -> overlap impossible. Each
run is INTENDED to be a cheap token check, with a full rebuild only when:
- the schedule cacheflushdate token moves        -> full horizon rebuild
- the fares token moves                          -> fares files only
- the horizon window rolls (new day at the edge) -> just the new date
- event {"mode": "today-refresh"}                -> today's files, with a
  ScheduleDivergence diff log: the standing instrument for whether
  /schedule/{date} drops same-day alert-cancelled sailings.
- event {"mode": "force-rebuild"}                -> full rebuild + fares,
  ignoring tokens - the operational lever after builder-logic changes
  (e.g. a quirk fix) that must reach the published files before the next
  upstream token change.

KNOWN ISSUE (task 40, 2026-08-04): production has been doing a full
532-call horizon rebuild on EVERY 15-minute run since this shipped
2026-07-29, not just on token moves - `cacheflushdate` looks like it
echoes request time rather than a stable last-changed stamp (unverified
live; the exploration samples for four sub-APIs each differ by roughly
the gap between when each was probed). That's almost certainly why a
routine run occasionally blows the timeout: a 532-call rebuild has been
eating ~470-520 s out of the budget on every single run instead of just
when the schedule actually changes. Tracked separately from the timeout
fix (which bought headroom via a longer timeout + no async retry) because
the right stable gating signal - ScheduleID/ScheduleName off the pair
envelope is one candidate - needs a live probe to confirm before changing
gating behavior. The decision log below (`ScheduleRefreshDecision`) is
the diagnostic instrument for that investigation.

Everything fetched is archived raw (fetch-time keys): upstream cannot serve
past dates, so this archive is the only history - load-bearing for M4.
"""

import json
import os
import time
from datetime import UTC, date, datetime, timedelta

import boto3
from wsf_core import WsfApiError, WsfClient
from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.fares import resolve_fares_verbose
from wsf_core.schedule import PairSchedule, TimeAdjustment
from wsf_core.ssm import get_access_code

from wsf_ingest.archive import ArchiveBatch
from wsf_ingest.metrics import emit
from wsf_ingest.pairs_builder import (
    build_adjustments_doc,
    build_pair_day,
    build_pair_fares,
    build_pairs_index,
)

META_PK = "META"
_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code(), transport_retries=1)
    return _client


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _spacing() -> float:
    return float(os.environ.get("UPSTREAM_SPACING_S", "0.3"))


def _horizon_days() -> int:
    return int(os.environ.get("HORIZON_DAYS", "14"))


def _fetch_retries() -> int:
    return int(os.environ.get("UPSTREAM_FETCH_RETRIES", "2"))


def _with_retries(fn, *args):
    """A full horizon rebuild makes hundreds of sequential upstream calls
    (532 for the current 14-day x 38-pair horizon); an isolated WSDOT 5xx or
    an already-exhausted transport retry must not abort the whole run and
    trip wsf-prod-schedule-refresh-errors over one blip (it did, 2026-08-08).

    Retries live here, at the call site, rather than in WsfClient: the
    client's own transport-only retry policy is deliberately caller-specific
    (the vessel poller wants zero retries and treats a failed poll as a data
    point; WsfClient never retries HTTP 4xx/5xx at all - see client.py). The
    refresher is the one caller that can afford a few seconds of backoff on
    any upstream error class, transport or HTTP, without missing its window.
    """
    retries = _fetch_retries()
    last_exc: WsfApiError | None = None
    for attempt in range(retries + 1):
        try:
            return fn(*args)
        except WsfApiError as exc:
            last_exc = exc
            if attempt >= retries:
                raise
            print(
                json.dumps(
                    {
                        "ScheduleFetchRetry": {
                            "attempt": attempt + 1,
                            "of": retries,
                            "error": str(exc),
                        }
                    }
                )
            )
            time.sleep(1.0 * (attempt + 1))
    raise last_exc  # pragma: no cover - loop above always returns or raises


def _get_token(table, name: str) -> str | None:
    resp = table.get_item(Key={"PK": META_PK, "SK": f"CACHEFLUSH#{name}"})
    return resp.get("Item", {}).get("token")


def _put_token(table, name: str, token: str) -> None:
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": f"CACHEFLUSH#{name}",
            "token": token,
            "updated_at_utc": datetime.now(UTC).isoformat(),
        }
    )


def _put_json(s3, key: str, payload: dict, max_age: int = 60) -> None:
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key=key,
        Body=json.dumps(payload, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl=f"public, max-age={max_age}",
    )


def _server_today(client: WsfClient) -> date:
    """validdaterange's floor IS server-today - sidesteps the midnight-lag quirk."""
    rng = _with_retries(client.valid_date_range, "schedule")
    dt = parse_dotnet_date(rng["DateFrom"])
    assert dt is not None
    # Midnight Pacific expressed in UTC shares the calendar date.
    return dt.date()


def lambda_handler(event, context):
    mode = (event or {}).get("mode", "scheduled")
    client, table, s3 = _wsf(), _table(), boto3.client("s3")

    # These three run unconditionally on every invocation (every 15 min),
    # before any rebuild logic - the highest-frequency upstream calls the
    # Lambda makes, so they get the same retry treatment as the rest.
    schedule_token = _with_retries(client.cache_flush_date, "schedule")
    fares_token = _with_retries(client.cache_flush_date, "fares")
    today = _server_today(client)

    horizon_item = table.get_item(Key={"PK": META_PK, "SK": "HORIZON#pairs"}).get("Item", {})
    stored_from = horizon_item.get("horizon_from")
    stored_sched_token = _get_token(table, "schedule")
    stored_fares_token = _get_token(table, "fares")

    counts = {"PairDatesPublished": 0, "FaresPublished": 0}

    force = mode == "force-rebuild"
    schedule_token_moved = schedule_token != stored_sched_token
    print(
        json.dumps(
            {
                "ScheduleRefreshDecision": {
                    "mode": mode,
                    "schedule_token_moved": schedule_token_moved,
                    "fares_token_moved": fares_token != stored_fares_token,
                    "stored_from": stored_from,
                    "today": today.isoformat(),
                    "will_rebuild_horizon": mode != "today-refresh"
                    and (force or schedule_token_moved or stored_from is None),
                }
            }
        )
    )
    if mode == "today-refresh":
        counts["PairDatesPublished"] = _refresh_today(client, table, s3, today)
    else:
        if force or schedule_token_moved or stored_from is None:
            counts["PairDatesPublished"] = _rebuild_horizon(client, table, s3, today)
            _put_token(table, "schedule", schedule_token)
        elif stored_from != today.isoformat():
            # Window rolled: publish just the newest date at the edge.
            new_date = today + timedelta(days=_horizon_days() - 1)
            counts["PairDatesPublished"] = _publish_dates(
                client, table, s3, today, [new_date], write_pair_items=False
            )
            _write_horizon(table, today)

        if force or fares_token != stored_fares_token:
            counts["FaresPublished"] = _publish_fares(client, s3, today, fares_token)
            _put_token(table, "fares", fares_token)

    # No-op runs emit nothing: the pairs-stale alarm treats missing data as
    # breaching over 24 h, and a constant no-op metric would burn a free slot.
    nonzero = {k: v for k, v in counts.items() if v > 0}
    if nonzero:
        emit(**nonzero)
    return counts


def _write_horizon(table, today: date) -> None:
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": "HORIZON#pairs",
            "horizon_from": today.isoformat(),
            "updated_at_utc": datetime.now(UTC).isoformat(),
        }
    )


def _fetch_system(client: WsfClient, today: date):
    d0 = today.isoformat()
    mates = _with_retries(client.terminals_and_mates_raw, d0)
    route_details = _with_retries(client.route_details_raw, d0)
    timeadj = [TimeAdjustment.model_validate(r) for r in _with_retries(client.timeadj_raw)]
    return mates, route_details, timeadj


def _derive_routes(envelopes: dict[tuple[int, int], dict]) -> dict[tuple[int, int], int | None]:
    routes: dict[tuple[int, int], int | None] = {}
    for (dep, arr), env in envelopes.items():
        ids = [
            r
            for c in env["TerminalCombos"]
            if c["DepartingTerminalID"] == dep and c["ArrivingTerminalID"] == arr
            for t in c["Times"]
            for r in t["Routes"]
        ]
        routes[(dep, arr)] = max(set(ids), key=ids.count) if ids else None
    return routes


def _rebuild_horizon(client, table, s3, today: date) -> int:
    dates = [today + timedelta(days=i) for i in range(_horizon_days())]
    return _publish_dates(client, table, s3, today, dates, write_pair_items=True, full=True)


def _publish_dates(
    client, table, s3, today, dates, *, write_pair_items: bool, full: bool = False
) -> int:
    mates, route_details, timeadj = _fetch_system(client, today)
    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    archive.add(fetched_at=datetime.now(UTC), status=200, body={"terminalsandmates": mates})
    archive.add(fetched_at=datetime.now(UTC), status=200, body={"routedetails": route_details})
    archive.add(
        fetched_at=datetime.now(UTC),
        status=200,
        body={"timeadj": [t.model_dump(mode="json", by_alias=False) for t in timeadj]},
    )

    pairs = [(m["DepartingTerminalID"], m["ArrivingTerminalID"]) for m in mates]
    dates = sorted(dates)

    # Fetch phase: every pair-date envelope (archived as fetched).
    envelopes: dict[tuple[tuple[int, int], date], dict] = {}
    for service_date in dates:
        d = service_date.isoformat()
        for pair in pairs:
            envelope = _with_retries(client.schedule_pair_raw, d, pair[0], pair[1])
            time.sleep(_spacing())
            archive.add(
                fetched_at=datetime.now(UTC),
                status=200,
                body={"pair": list(pair), "date": d, "schedule": envelope},
            )
            envelopes[(pair, service_date)] = envelope

    # Route derivation needs the earliest fetched date's envelopes complete
    # BEFORE any building (crossing_min/adjustment matching depend on it).
    first_date = dates[0]
    pair_routes = _derive_routes({p: envelopes[(p, first_date)] for p in pairs})
    route_counts: dict[int, int] = {}
    for r in pair_routes.values():
        if r is not None:
            route_counts[r] = route_counts.get(r, 0) + 1
    routes_by_id = {rd["RouteID"]: rd for rd in route_details}

    # Build phase, in date order for the post-midnight tail dedup.
    now = datetime.now(UTC)
    published = 0
    prev_keys: dict[tuple[int, int], set] = {p: set() for p in pairs}
    for date_i, service_date in enumerate(dates):
        for pair in pairs:
            dep, arr = pair
            pair_sched = PairSchedule.from_envelope(envelopes[(pair, service_date)], dep, arr)
            route_id = pair_routes.get(pair)
            crossing_raw = routes_by_id.get(route_id, {}).get("CrossingTime") if route_id else None
            day, keys = build_pair_day(
                pair_schedule=pair_sched,
                service_date=service_date,
                crossing_min=int(crossing_raw) if crossing_raw not in (None, "") else None,
                route_id=route_id,
                route_pair_count=route_counts.get(route_id, 0),
                adjustments=timeadj,
                prev_day_keys=prev_keys[pair],
                now=now,
            )
            prev_keys[pair] = keys
            _put_json(s3, f"data/pairs/{dep}-{arr}/{service_date.isoformat()}.json", day)
            published += 1
            if write_pair_items and date_i <= 1:
                _write_pair_items(day)

    if full:
        schedule_meta = envelopes[(pairs[0], first_date)] if pairs else {}
        index = build_pairs_index(
            mates=mates,
            route_details=route_details,
            pair_routes=pair_routes,
            terminals=_terminals_from_mates(mates),
            schedule_meta=schedule_meta,
            horizon_from=today,
            horizon_days=_horizon_days(),
            now=now,
        )
        _put_json(s3, "data/pairs/index.json", index)
        # The season-wide service calendar rides the same full-rebuild
        # trigger: timeadj rows only move when the schedule token does.
        adjustments_doc = build_adjustments_doc(
            adjustments=timeadj,
            route_details=route_details,
            from_date=today,
            now=now,
        )
        _put_json(s3, "data/adjustments.json", adjustments_doc, max_age=300)
        _write_horizon(table, today)

    archive.flush(dataset="schedule_refresh")
    return published


def _terminals_from_mates(mates: list[dict]) -> list[dict]:
    seen: dict[int, str] = {}
    for m in mates:
        seen.setdefault(m["DepartingTerminalID"], m["DepartingDescription"])
        seen.setdefault(m["ArrivingTerminalID"], m["ArrivingDescription"])
    return [{"TerminalID": tid, "Description": name} for tid, name in seen.items()]


def _write_pair_items(day: dict) -> None:
    table = _table()
    dep, arr = day["pair"]["dep"], day["pair"]["arr"]
    with table.batch_writer() as batch:
        for s in day["sailings"]:
            batch.put_item(
                Item={
                    "PK": f"PAIR#{dep:04d}#{arr:04d}",
                    "SK": f"DEP#{s['depart']}",
                    "vessel_id": s["vessel_id"],
                    "vessel_name": s["vessel"],
                    "depart_ms": s["depart_ms"],
                    "service_date": day["service_date"],
                    "loading_rule": s["loading_rule"],
                    "added": s["added"],
                    "expires_at": s["depart_ms"] // 1000 + 6 * 3600,
                }
            )


def _refresh_today(client, table, s3, today: date) -> int:
    """Re-pull today's pairs, diff against what's being served, log divergence."""
    bucket = os.environ["DATA_BUCKET"]
    d = today.isoformat()
    mates, _route_details, _timeadj = _fetch_system(client, today)
    # Reuse the standard publish path for correctness; but first capture the
    # currently-served sailing sets for the divergence diff.
    served: dict[str, set] = {}
    for m in mates:
        dep, arr = m["DepartingTerminalID"], m["ArrivingTerminalID"]
        key = f"data/pairs/{dep}-{arr}/{d}.json"
        try:
            body = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
            served[key] = {(x["vessel_id"], x["depart_ms"]) for x in body["sailings"]}
        except Exception:
            served[key] = set()

    published = _publish_dates(client, table, s3, today, [today], write_pair_items=True)

    for m in mates:
        dep, arr = m["DepartingTerminalID"], m["ArrivingTerminalID"]
        key = f"data/pairs/{dep}-{arr}/{d}.json"
        body = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
        fresh = {(x["vessel_id"], x["depart_ms"]) for x in body["sailings"]}
        removed, appeared = served[key] - fresh, fresh - served[key]
        if removed or appeared:
            print(
                json.dumps(
                    {
                        "ScheduleDivergence": {
                            "pair": [dep, arr],
                            "date": d,
                            "removed": sorted(removed),
                            "appeared": sorted(appeared),
                        }
                    }
                )
            )
    return published


def _publish_fares(client, s3, today: date, token: str) -> int:
    payload = _with_retries(client.fare_line_items_verbose_raw, today.isoformat())
    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    archive.add(fetched_at=datetime.now(UTC), status=200, body={"farelineitemsverbose": payload})
    archive.flush(dataset="fares")

    now = datetime.now(UTC)
    published = 0
    for fares in resolve_fares_verbose(payload):
        doc = build_pair_fares(fares=fares, trip_date=today, retrieved_at=now, source_token=token)
        _put_json(
            s3,
            f"data/fares/{fares.dep_terminal_id}-{fares.arr_terminal_id}.json",
            doc,
            max_age=300,
        )
        published += 1
    return published
