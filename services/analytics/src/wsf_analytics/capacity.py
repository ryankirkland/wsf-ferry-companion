"""Terminal drive-up capacity poller (M4 D1). 24/7 on purpose: the feed
is current-state only, so every unpolled minute is history that never
exists. Overnight [] responses archive as ~40-byte objects and keep
re-verifying the only-some-terminals-report quirk. The /data/capacity.json
serving contract lands in W1; this stage is the recorder.
"""

import os
from datetime import UTC, datetime

import boto3
from wsf_core import WsfClient
from wsf_core.ssm import get_access_code

from wsf_analytics.metrics import emit

_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code())
    return _client


def lambda_handler(event, context):
    from wsf_core.archive import ArchiveBatch

    rows = _wsf().terminal_sailing_space_raw()
    archive = ArchiveBatch(boto3.client("s3"), os.environ["RAW_BUCKET"])
    archive.add(fetched_at=datetime.now(UTC), status=200, body=rows)
    key = archive.flush(dataset="terminalsailingspace")
    if rows:
        emit(CapacityTerminalsReporting=len(rows))
    return {"terminals": len(rows), "key": key}
