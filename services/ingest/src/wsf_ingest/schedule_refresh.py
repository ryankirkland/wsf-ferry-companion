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

Task 40's suspicion is now confirmed from billing + CloudTrail (2026-08-15):
`cacheflushdate` churns on essentially every poll while the timetable stays
identical, so production ran a full 532-call horizon rebuild every 15
minutes since 2026-07-29 (~51k identical S3 PUTs/day, the bulk of the
account's S3 bill). A rebuild is therefore no longer a republish: every S3
publish passes a content gate - the payload is hashed minus its volatile
fields (generated_at/retrieved_at/source_token) and skipped when identical
to what is already served. DynamoDB pair items are NOT gated: the alert
citation join reads them, and their freshness must not depend on file
churn. force-rebuild bypasses the gate. The 532-call fetch itself still
runs on every token move (the `ScheduleRefreshDecision` log remains the
instrument for that); gating the fetch phase is the follow-up, task 44.

Everything fetched is archived raw (fetch-time keys): upstream cannot serve
past dates, so this archive is the only history - load-bearing for M4.
"""

import hashlib
import json
import os
import time
from datetime import UTC, date, datetime, timedelta

import boto3
from wsf_core import WsfClient
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


# Excluded from content hashing: these change on every build even when the
# data is identical, and none of them is load-bearing for consumers (the
# trip planner reads sailings, not timestamps; source_token is provenance).
_VOLATILE_KEYS = ("generated_at", "retrieved_at", "source_token")
_HASHES_SK = "PUBLISHHASH#v1"


def _content_hash(payload: dict) -> str:
    stable = {k: v for k, v in payload.items() if k not in _VOLATILE_KEYS}
    return hashlib.sha256(
        json.dumps(stable, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()[:16]


def _load_hashes(table) -> dict[str, str]:
    item = table.get_item(Key={"PK": META_PK, "SK": _HASHES_SK}).get("Item", {})
    return dict(item.get("hashes", {}))


def _save_hashes(table, hashes: dict[str, str]) -> None:
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": _HASHES_SK,
            "hashes": hashes,
            "updated_at_utc": datetime.now(UTC).isoformat(),
        }
    )


def _put_json_gated(
    s3, hashes: dict[str, str], key: str, payload: dict, max_age: int = 60, force: bool = False
) -> bool:
    """Publish only when the non-volatile content differs from what is
    already served; returns whether a PUT happened. A skipped publish keeps
    the served file's original generated_at, which is truthful - the content
    genuinely has not changed since then."""
    digest = _content_hash(payload)
    if not force and hashes.get(key) == digest:
        return False
    _put_json(s3, key, payload, max_age)
    hashes[key] = digest
    return True


def _server_today(client: WsfClient) -> date:
    """validdaterange's floor IS server-today - sidesteps the midnight-lag quirk."""
    rng = client.valid_date_range("schedule")
    dt = parse_dotnet_date(rng["DateFrom"])
    assert dt is not None
    # Midnight Pacific expressed in UTC shares the calendar date.
    return dt.date()


def lambda_handler(event, context):
    mode = (event or {}).get("mode", "scheduled")
    client, table, s3 = _wsf(), _table(), boto3.client("s3")

    schedule_token = client.cache_flush_date("schedule")
    fares_token = client.cache_flush_date("fares")
    today = _server_today(client)

    horizon_item = table.get_item(Key={"PK": META_PK, "SK": "HORIZON#pairs"}).get("Item", {})
    stored_from = horizon_item.get("horizon_from")
    stored_sched_token = _get_token(table, "schedule")
    stored_fares_token = _get_token(table, "fares")

    counts = {
        "PairDatesPublished": 0,
        "PairDatesUnchanged": 0,
        "FaresPublished": 0,
        "FaresUnchanged": 0,
    }
    hashes = _load_hashes(table)
    hashes_before = dict(hashes)

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
        counts["PairDatesPublished"], counts["PairDatesUnchanged"] = _refresh_today(
            client, table, s3, today, hashes
        )
    else:
        if force or schedule_token_moved or stored_from is None:
            counts["PairDatesPublished"], counts["PairDatesUnchanged"] = _rebuild_horizon(
                client, table, s3, today, hashes, force=force
            )
            _put_token(table, "schedule", schedule_token)
        elif stored_from != today.isoformat():
            # Window rolled: publish just the newest date at the edge.
            new_date = today + timedelta(days=_horizon_days() - 1)
            counts["PairDatesPublished"], counts["PairDatesUnchanged"] = _publish_dates(
                client, table, s3, today, [new_date], hashes, write_pair_items=False
            )
            _write_horizon(table, today)

        if force or fares_token != stored_fares_token:
            counts["FaresPublished"], counts["FaresUnchanged"] = _publish_fares(
                client, s3, today, fares_token, hashes, force=force
            )
            _put_token(table, "fares", fares_token)

    if hashes != hashes_before:
        _save_hashes(table, hashes)

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
    mates = client.terminals_and_mates_raw(d0)
    route_details = client.route_details_raw(d0)
    timeadj = [TimeAdjustment.model_validate(r) for r in client.timeadj_raw()]
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


def _rebuild_horizon(client, table, s3, today: date, hashes: dict, *, force: bool = False):
    dates = [today + timedelta(days=i) for i in range(_horizon_days())]
    return _publish_dates(
        client, table, s3, today, dates, hashes, write_pair_items=True, full=True, force=force
    )


def _publish_dates(
    client,
    table,
    s3,
    today,
    dates,
    hashes: dict,
    *,
    write_pair_items: bool,
    full: bool = False,
    force: bool = False,
) -> tuple[int, int]:
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
            envelope = client.schedule_pair_raw(d, pair[0], pair[1])
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
    skipped = 0
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
            if _put_json_gated(
                s3,
                hashes,
                f"data/pairs/{dep}-{arr}/{service_date.isoformat()}.json",
                day,
                force=force,
            ):
                published += 1
            else:
                skipped += 1
            # Not gated: the alert-citation join reads these items, and their
            # freshness must not depend on whether the S3 file changed.
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
        _put_json_gated(s3, hashes, "data/pairs/index.json", index, force=force)
        # The season-wide service calendar rides the same full-rebuild
        # trigger: timeadj rows only move when the schedule token does.
        adjustments_doc = build_adjustments_doc(
            adjustments=timeadj,
            route_details=route_details,
            from_date=today,
            now=now,
        )
        _put_json_gated(
            s3, hashes, "data/adjustments.json", adjustments_doc, max_age=300, force=force
        )
        _write_horizon(table, today)

    archive.flush(dataset="schedule_refresh")
    return published, skipped


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


def _refresh_today(client, table, s3, today: date, hashes: dict) -> tuple[int, int]:
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
            # Reconcile the gate with reality: today-refresh gates against the
            # bytes actually served, not the hash of what was last written - a
            # tampered or corrupted file must be repaired, not protected by
            # its own stale hash.
            hashes[key] = _content_hash(body)
        except Exception:
            served[key] = set()
            hashes.pop(key, None)

    published, skipped = _publish_dates(
        client, table, s3, today, [today], hashes, write_pair_items=True
    )

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
    return published, skipped


def _publish_fares(
    client, s3, today: date, token: str, hashes: dict, *, force: bool = False
) -> tuple[int, int]:
    payload = client.fare_line_items_verbose_raw(today.isoformat())
    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    archive.add(fetched_at=datetime.now(UTC), status=200, body={"farelineitemsverbose": payload})
    archive.flush(dataset="fares")

    now = datetime.now(UTC)
    published = 0
    skipped = 0
    for fares in resolve_fares_verbose(payload):
        doc = build_pair_fares(fares=fares, trip_date=today, retrieved_at=now, source_token=token)
        if _put_json_gated(
            s3,
            hashes,
            f"data/fares/{fares.dep_terminal_id}-{fares.arr_terminal_id}.json",
            doc,
            max_age=300,
            force=force,
        ):
            published += 1
        else:
            skipped += 1
    return published, skipped
