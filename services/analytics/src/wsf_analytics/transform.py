"""Transform Lambda (M4 D2): raw vesselhistory NDJSON -> year-partitioned
zstd Parquet, ONE file per year, same-key overwrite (S3 PUTs are atomic
and strongly consistent; under partition projection a versioned second
file would silently double-count).

Event: {"years": [2002, ...]} - explicit, so the nightly chain (sync
passes the service years its window touched), quarantine re-drains after
alias curation, and the historical rebuild are all the same code path.

Rules (per the M4 plan review):
- Rows bucket by PACIFIC wall-clock service year (ZoneInfo handles every
  DST rule back to 2002); depart_hhmm_local + service_date materialize
  here so Athena never does timezone math.
- Dedup key (vessel_name, scheduled_ms); the row from the envelope with
  the latest fetched_at wins (lookback windows re-deliver corrections).
- Null ScheduledDepart -> skip + metric. Null slips -> quarantine
  ("null_slip"). Slips outside the curated map -> quarantine
  ("unmapped_slip") + UnmappedSlip metric. Null ActualDepart keeps the
  row with null delay - never inferred as cancelled.
- route_id is a best-effort annotation from the live pairs index;
  terminal PAIR is the primary dimension (Sidney-era rows keep id 19).
"""

import gzip
import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.slips import SLIP_TERMINALS

from wsf_analytics.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
RAW_PREFIX = "raw/vesselhistory/"
OUT_PREFIX = "analytics/history/"
QUARANTINE_PREFIX = "analytics/quarantine/"

SCHEMA = pa.schema(
    [
        ("vessel_name", pa.string()),
        ("departing_terminal_id", pa.int32()),
        ("arriving_terminal_id", pa.int32()),
        ("route_id", pa.int32()),
        ("service_date", pa.date32()),
        ("depart_hhmm_local", pa.string()),
        ("scheduled_depart", pa.timestamp("ms")),
        ("actual_depart", pa.timestamp("ms")),
        ("delay_min", pa.float32()),
    ]
)


def _list_raw_keys(s3, bucket: str) -> list[str]:
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=RAW_PREFIX):
        keys += [o["Key"] for o in page.get("Contents", [])]
    return keys


def _pair_routes() -> dict[tuple[int, int], int]:
    try:
        body = (
            boto3.client("s3")
            .get_object(Bucket=os.environ["DATA_BUCKET"], Key="data/pairs/index.json")["Body"]
            .read()
        )
        index = json.loads(body)
        return {
            (p["dep"], p["arr"]): p["route_id"]
            for p in index["pairs"]
            if p.get("route_id") is not None
        }
    except Exception:
        return {}  # annotation only - never a reason to fail a rebuild


def lambda_handler(event, context):
    years = set(event["years"])
    bucket = os.environ["RAW_BUCKET"]
    s3 = boto3.client("s3")
    routes = _pair_routes()

    keys = _list_raw_keys(s3, bucket)
    counts = {
        "RowsIn": 0,
        "RowsWritten": 0,
        "DuplicatesDropped": 0,
        "NullSchedule": 0,
        "NullSlip": 0,
        "UnmappedSlip": 0,
    }
    # (vessel, sched_ms) -> (fetched_at, normalized row) for requested years
    best: dict[tuple[str, int], tuple[str, dict]] = {}
    quarantine: list[dict] = []

    def fetch(key: str) -> bytes:
        return s3.get_object(Bucket=bucket, Key=key)["Body"].read()

    with ThreadPoolExecutor(max_workers=16) as pool:
        for key, blob in zip(keys, pool.map(fetch, keys)):
            for line in gzip.decompress(blob).decode().strip().split("\n"):
                rec = json.loads(line)
                fetched_at = rec.get("fetched_at", "")
                for row in rec["body"].get("rows", []):
                    counts["RowsIn"] += 1
                    sched = parse_dotnet_date(row.get("ScheduledDepart"))
                    if sched is None:
                        counts["NullSchedule"] += 1
                        continue
                    local = sched.astimezone(SOUND_TZ)
                    if local.year not in years:
                        continue
                    vessel = row.get("Vessel") or ""
                    dedup_key = (vessel, int(sched.timestamp() * 1000))
                    prior = best.get(dedup_key)
                    if prior is not None:
                        counts["DuplicatesDropped"] += 1
                        if fetched_at <= prior[0]:
                            continue
                    dep_slip, arr_slip = row.get("Departing"), row.get("Arriving")
                    if dep_slip is None or arr_slip is None:
                        counts["NullSlip"] += 1
                        quarantine.append({"reason": "null_slip", "row": row})
                        continue
                    dep = SLIP_TERMINALS.get(dep_slip)
                    arr = SLIP_TERMINALS.get(arr_slip)
                    if dep is None or arr is None:
                        counts["UnmappedSlip"] += 1
                        quarantine.append({"reason": "unmapped_slip", "row": row})
                        continue
                    actual = parse_dotnet_date(row.get("ActualDepart"))
                    delay = (actual - sched).total_seconds() / 60.0 if actual is not None else None
                    best[dedup_key] = (
                        fetched_at,
                        {
                            "vessel_name": vessel,
                            "departing_terminal_id": dep,
                            "arriving_terminal_id": arr,
                            "route_id": routes.get((dep, arr)),
                            "service_date": local.date(),
                            "depart_hhmm_local": local.strftime("%H:%M"),
                            "scheduled_depart": sched.astimezone(UTC).replace(tzinfo=None),
                            "actual_depart": (
                                actual.astimezone(UTC).replace(tzinfo=None) if actual else None
                            ),
                            "delay_min": delay,
                            "_year": local.year,
                        },
                    )

    by_year: dict[int, list[dict]] = {}
    for _, row in best.values():
        by_year.setdefault(row.pop("_year"), []).append(row)

    written = {}
    for year in sorted(years):
        rows = by_year.get(year, [])
        if not rows:
            continue
        table = pa.Table.from_pylist(rows, schema=SCHEMA)
        buf = io.BytesIO()
        pq.write_table(table, buf, compression="zstd")
        s3.put_object(
            Bucket=bucket,
            Key=f"{OUT_PREFIX}year={year}/part-0.parquet",
            Body=buf.getvalue(),
        )
        written[year] = len(rows)
        counts["RowsWritten"] += len(rows)

    if quarantine:
        now = datetime.now(UTC)
        s3.put_object(
            Bucket=bucket,
            Key=f"{QUARANTINE_PREFIX}dt={now:%Y-%m-%d}/{now:%H%M%S}.ndjson.gz",
            Body=gzip.compress(
                (
                    "\n".join(json.dumps(q, separators=(",", ":")) for q in quarantine) + "\n"
                ).encode()
            ),
            ContentType="application/x-ndjson",
            ContentEncoding="gzip",
        )

    emit(**{k: v for k, v in counts.items() if v > 0})
    print(json.dumps({"Transform": {"written": written, **counts}}))

    if os.environ.get("STATS_FUNCTION") and event.get("chain", True) and written:
        boto3.client("lambda").invoke(
            FunctionName=os.environ["STATS_FUNCTION"],
            InvocationType="Event",
            Payload=json.dumps({"trigger": "transform"}).encode(),
        )
    return {"written": written, **counts}
