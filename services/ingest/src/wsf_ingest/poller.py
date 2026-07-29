"""The vessellocations poller Lambda: one invocation = one minute = 4 polls.

Timing spec (ADR-0005): EventBridge rate(1 minute), retry 0, reserved
concurrency 1, timeout 55 s. Internal loop targets t0 + 0/15/30/45 s on the
monotonic clock; an iteration more than 5 s behind its slot is skipped
(SkippedPoll), never bursted.

Failure taxonomy per iteration:
- transport/5xx: one retry after 2 s if >= 8 s remain in the slot, else count
  PollFailure and move on - Lambda Errors is reserved for bugs.
- 400 + JSON Message (WsfAuthError): AuthFailure, abort remaining iterations.
- 200 + []: EmptyFleet, keep the last good snapshot, never retry.
"""

import json
import os
import time
from datetime import UTC, datetime

import boto3
from wsf_core import VesselLocation, WsfApiError, WsfAuthError, WsfClient
from wsf_core.ssm import get_access_code

from wsf_ingest.archive import ArchiveBatch
from wsf_ingest.ddb import FleetWriter
from wsf_ingest.metrics import emit
from wsf_ingest.snapshot import build_snapshot

LATE_SKIP_S = 5.0
RETRY_MIN_HEADROOM_S = 8.0

_client: WsfClient | None = None
_writer: FleetWriter | None = None


def _deps() -> tuple[WsfClient, FleetWriter, object]:
    """Module-lifetime client/writer/s3 (warm containers keep the dedup cache)."""
    global _client, _writer
    if _client is None:
        _client = WsfClient(get_access_code())
    if _writer is None:
        table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
        _writer = FleetWriter(table)
    return _client, _writer, boto3.client("s3")


def _put_snapshot(s3, fleet, now: datetime) -> None:
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key="data/fleet.json",
        Body=json.dumps(build_snapshot(fleet, now), separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl="public, max-age=5, must-revalidate",
    )


def lambda_handler(event, context):
    poll_spacing_s = float(os.environ.get("POLL_SPACING_S", "15"))
    poll_iterations = int(os.environ.get("POLL_ITERATIONS", "4"))
    client, writer, s3 = _deps()
    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    counts = {
        "PollSuccess": 0,
        "PollFailure": 0,
        "AuthFailure": 0,
        "EmptyFleet": 0,
        "SkippedPoll": 0,
        "VesselsWritten": 0,
    }
    last_error: str | None = None

    t0 = time.monotonic()
    for i in range(poll_iterations):
        target = t0 + i * poll_spacing_s
        behind = time.monotonic() - target
        if behind > LATE_SKIP_S:
            counts["SkippedPoll"] += 1
            continue
        if behind < 0:
            time.sleep(-behind)

        try:
            fleet = _poll_once(client, archive)
        except WsfAuthError as exc:
            counts["AuthFailure"] += 1
            last_error = str(exc)
            break  # hammering an auth failure helps nobody
        except WsfApiError as exc:
            # One retry if the slot still has headroom.
            slot_end = t0 + (i + 1) * poll_spacing_s
            if slot_end - time.monotonic() >= RETRY_MIN_HEADROOM_S:
                time.sleep(2)
                try:
                    fleet = _poll_once(client, archive)
                except WsfApiError as exc2:
                    counts["PollFailure"] += 1
                    last_error = str(exc2)
                    continue
            else:
                counts["PollFailure"] += 1
                last_error = str(exc)
                continue

        if not fleet:
            counts["EmptyFleet"] += 1
            last_error = "200 with empty vessel list"
            continue

        now = datetime.now(UTC)
        counts["VesselsWritten"] += writer.write_changed(fleet, now)
        try:
            _put_snapshot(s3, fleet, now)
        except Exception as exc:  # snapshot is serving-impacting: count, keep looping
            counts["PollFailure"] += 1
            last_error = f"snapshot put: {exc}"
            continue
        counts["PollSuccess"] += 1

    try:
        archive.flush()
    except Exception as exc:  # archive loss is not serving-impacting: log only
        print(f"ArchiveFailure: {exc}")
    writer.write_meta(
        polls_ok=counts["PollSuccess"],
        polls_failed=counts["PollFailure"] + counts["AuthFailure"] + counts["EmptyFleet"],
        last_error=last_error,
    )
    emit(**counts)
    return counts


def _poll_once(client: WsfClient, archive: ArchiveBatch) -> list[VesselLocation]:
    fetched_at = datetime.now(UTC)
    rows = client.vessel_locations_raw()
    # Raw rows archived verbatim - parsing drops fields (extra="ignore") and
    # the archive's whole job is preserving what upstream actually said.
    archive.add(fetched_at=fetched_at, status=200, body=rows)
    return [VesselLocation.model_validate(r) for r in rows]
