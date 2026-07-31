"""Vesselhistory collector Lambda (M4 D1). Raw-only: the transform (D2)
is the single normalization path for backfill and nightly data alike.

Modes:
- scheduled (cron 03:30 America/Los_Angeles): for every vessel in the
  dims feed, fetch a trailing 7-day window (same cost as 3 days, more
  outage tolerance) - "yesterday" is computed in Pacific, never from the
  UTC clock date. On the 1st of the month, the window widens to
  year-to-date to absorb late corrections (the nightly full-year rewrite
  makes this free downstream).
- {"mode": "backfill", "vessel": "<name>", "years": [2002, ...]}: one
  polite year-window call per year (>= 1 s spacing; undocumented
  endpoint, no rate contract - invokes are run SEQUENTIALLY by the
  operator). Each completed (vessel, year) writes a DDB completion
  marker so gaps are visible and re-runs are targeted.

Per-vessel isolation: one failing vessel never aborts the sweep; every
failure is a metric, and a totally empty night is its own signal (a bad
name and an empty window are indistinguishable upstream - 200 []).
"""

import json
import os
import time
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import boto3
from wsf_core import WsfClient
from wsf_core.ssm import get_access_code

from wsf_analytics.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
BACKFILL_FLOOR = "2002-03-01"  # verified data floor (exploration 2026-07-24)
SPACING_S = 1.2

_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code(), transport_retries=1)
    return _client


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _fleet_names() -> list[str]:
    body = (
        boto3.client("s3")
        .get_object(Bucket=os.environ["DATA_BUCKET"], Key="data/vessels.json")["Body"]
        .read()
    )
    doc = json.loads(body)
    vessels = doc["vessels"] if isinstance(doc, dict) else doc
    return sorted({v["name"] for v in vessels})


def slugify(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def lambda_handler(event, context):
    from wsf_core.archive import ArchiveBatch

    mode = (event or {}).get("mode", "scheduled")
    s3 = boto3.client("s3")
    client = _wsf()

    if mode == "backfill":
        return _backfill(client, s3, ArchiveBatch, event)

    today = datetime.now(SOUND_TZ).date()
    start = today.replace(month=1, day=1) if today.day == 1 else today - timedelta(days=7)
    window = (start.isoformat(), today.isoformat())

    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    counts = {"HistoryVesselsFetched": 0, "HistoryVesselFailures": 0, "HistoryRowsFetched": 0}
    for name in _fleet_names():
        try:
            rows = client.vessel_history_raw(name, *window)
            archive.add(
                fetched_at=datetime.now(UTC),
                status=200,
                body={"vessel": name, "date_start": window[0], "date_end": window[1], "rows": rows},
            )
            counts["HistoryVesselsFetched"] += 1
            counts["HistoryRowsFetched"] += len(rows)
        except Exception as exc:  # isolation: one vessel never sinks the sweep
            counts["HistoryVesselFailures"] += 1
            print(json.dumps({"HistoryFetchFailure": {"vessel": name, "error": str(exc)}}))
        time.sleep(SPACING_S)

    key = archive.flush(dataset="vesselhistory")
    if counts["HistoryRowsFetched"] == 0 and counts["HistoryVesselsFetched"] > 0:
        # Every vessel answered [] - upstream outage or vocabulary drift,
        # never plain "no sailings happened this week".
        counts["HistoryEmptyNight"] = 1
    emit(**{k: v for k, v in counts.items() if v > 0})
    return {**counts, "key": key, "window": window}


def _backfill(client, s3, archive_cls, event) -> dict:
    vessel = event["vessel"]
    years = event["years"]
    table = _table()
    results = {}
    for year in years:
        start = BACKFILL_FLOOR if year == 2002 else f"{year}-01-01"
        end = f"{year}-12-31"
        rows = client.vessel_history_raw(vessel, start, end)
        archive = archive_cls(s3, os.environ["RAW_BUCKET"])
        archive.add(
            fetched_at=datetime.now(UTC),
            status=200,
            body={"vessel": vessel, "date_start": start, "date_end": end, "rows": rows},
        )
        archive.flush(dataset="vesselhistory", suffix=f"{slugify(vessel)}-{year}")
        table.put_item(
            Item={
                "PK": "META",
                "SK": f"BACKFILL#{slugify(vessel)}#{year}",
                "rows": len(rows),
                "fetched_at_utc": datetime.now(UTC).isoformat(),
            }
        )
        results[year] = len(rows)
        time.sleep(SPACING_S)
    total = sum(results.values())
    emit(HistoryRowsFetched=total)
    if total == 0:
        # A whole backfill returning nothing is a name/vocabulary alarm,
        # not evidence of an idle vessel (200 [] is silent upstream).
        emit(BackfillZeroRows=1)
    print(json.dumps({"Backfill": {"vessel": vessel, "rows_by_year": results}}))
    return {"vessel": vessel, "rows_by_year": results}
