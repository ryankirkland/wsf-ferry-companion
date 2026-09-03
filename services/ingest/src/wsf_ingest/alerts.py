"""Alerts poller Lambda: the 1-minute same-day-truth sensor.

Watermark-gated: identical feed -> exit with zero writes. On change:
publish the slimmed /data/alerts.json, archive raw, async-invoke the
notifier (M3 fan-out - it owns all per-bulletin diff state) and the
schedule refresher's today-refresh (the ScheduleDivergence instrument),
and write the watermark LAST: a crash before the watermark makes the
next minute repeat everything, and duplicate invokes are absorbed by
the notifier's conditional writes. The reverse order would silently
swallow notifications. Errors propagate - the next minute is the retry.

The watermark is a full-feed digest (see wsf_core.alerts): the M2
max-based version was blind to edits and withdrawals.
"""

import json
import os
from datetime import UTC, datetime

import boto3
from wsf_core import WsfClient
from wsf_core.alerts import Alert, alerts_watermark
from wsf_core.ssm import get_access_code

from wsf_ingest.archive import ArchiveBatch
from wsf_ingest.metrics import emit

META_PK = "META"
_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code())
    return _client


def lambda_handler(event, context):
    client = _wsf()
    table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    s3 = boto3.client("s3")

    raw = client.alerts_raw()
    alerts = [Alert.model_validate(a) for a in raw]
    watermark = alerts_watermark(alerts)

    stored = (
        table.get_item(Key={"PK": META_PK, "SK": "ALERTS#watermark"})
        .get("Item", {})
        .get("watermark")
    )
    if watermark == stored:
        return {"changed": False}

    now = datetime.now(UTC)
    payload = {
        "v": 1,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "watermark": watermark,
        "alerts": [
            {
                "id": a.id,
                "title": a.title,
                "text": a.text,
                "body": a.body,
                "published": a.published.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                "route_ids": a.route_ids,
                "all_routes": a.all_routes,
            }
            for a in sorted(alerts, key=lambda a: a.published, reverse=True)
        ],
    }
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key="data/alerts.json",
        Body=json.dumps(payload, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl="public, max-age=5, must-revalidate",
    )

    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    archive.add(fetched_at=now, status=200, body=raw)
    archive.flush(dataset="alerts")

    lam = boto3.client("lambda")
    if notifier := os.environ.get("NOTIFIER_FUNCTION"):
        lam.invoke(
            FunctionName=notifier,
            InvocationType="Event",
            Payload=json.dumps(
                {"observed_at_ms": int(now.timestamp() * 1000), "alerts": payload["alerts"]}
            ).encode(),
        )
    if refresher := os.environ.get("REFRESHER_FUNCTION"):
        lam.invoke(
            FunctionName=refresher,
            InvocationType="Event",
            Payload=json.dumps({"mode": "today-refresh"}).encode(),
        )

    # Watermark last: everything above is idempotent-or-absorbed on repeat.
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": "ALERTS#watermark",
            "watermark": watermark,
            "updated_at_utc": now.isoformat(),
        }
    )

    emit(AlertsChanged=1)
    return {"changed": True, "watermark": watermark}
