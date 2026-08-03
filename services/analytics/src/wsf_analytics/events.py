"""Site-analytics collector (F6 D1): a public, unauthenticated beacon hit
by navigator.sendBeacon from every page load and tracked click. Reached
only through the site's CloudFront distribution at /v1/events - never
called directly - so CloudFront has already resolved geography into
cloudfront-viewer-* headers and the real client IP into X-Forwarded-For
(API Gateway's own sourceIp is CloudFront's edge IP, not the visitor's).

Validation is cheap and defensive: there's no upstream retry/DLQ for this
endpoint and it's public, so a client sending garbage all night must 400,
never 500 and never page anyone.

Privacy is load-bearing here, not a style preference (approved PRD): the
visitor hash is a one-way, month-salted digest of IP + user-agent, and
the raw IP is never written anywhere - not S3, not logs, not metrics.
"""

import base64
import hashlib
import json
import os
from datetime import UTC, datetime
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import boto3

from wsf_analytics.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
MAX_PATH = 200
MAX_REFERRER = 100
MAX_LABEL = 60
VALID_TYPES = ("pageview", "click")


def _resp(status: int, body: dict | None = None) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body) if body is not None else "",
    }


def _headers(event: dict) -> dict:
    return event.get("headers") or {}


def _client_ip(event: dict) -> str:
    xff = _headers(event).get("x-forwarded-for", "")
    first = xff.split(",", 1)[0].strip()
    if first:
        return first
    # Local/dev testing without CloudFront in front - never the real
    # viewer IP once deployed, but keeps local invocation from crashing.
    return (event.get("requestContext") or {}).get("http", {}).get("sourceIp", "")


def _visitor_hash(event: dict) -> str:
    ip = _client_ip(event)
    ua = _headers(event).get("user-agent", "")
    month = datetime.now(SOUND_TZ).strftime("%Y-%m")
    # Raw ip/ua live only inside this digest and are discarded the moment
    # this function returns - they must never reach a log line or S3 body.
    return hashlib.sha256(f"{month}:{ip}:{ua}".encode()).hexdigest()[:16]


def _geo(event: dict) -> dict:
    headers = _headers(event)
    return {
        "country": headers.get("cloudfront-viewer-country") or "unknown",
        "region": headers.get("cloudfront-viewer-country-region") or "unknown",
        "city": headers.get("cloudfront-viewer-city") or "unknown",
    }


def _clean_path(raw) -> tuple[str | None, str | None]:
    if not isinstance(raw, str) or not raw:
        return None, "path is required"
    if len(raw) > MAX_PATH:
        return None, f"path exceeds {MAX_PATH} chars"
    if not raw.startswith("/"):
        return None, "path must start with '/'"
    # Never persist query params - they can carry PII (e.g. an email
    # confirmation token) - and the fragment is client-only anyway.
    return raw.split("?", 1)[0].split("#", 1)[0], None


def _own_host(event: dict) -> str:
    return _headers(event).get("host", "").split(":", 1)[0].lower()


def _referrer_host(raw, own_host: str) -> str:
    if not isinstance(raw, str) or not raw:
        return "direct"
    try:
        host = urlparse(raw).hostname
    except ValueError:
        host = None
    if not host or host.lower() == own_host:
        return "direct"
    # A referrer this long is not a normal hostname; degrade rather than
    # reject the whole event over an optional, informational field.
    return host if len(host) <= MAX_REFERRER else "direct"


def _validate(body: dict) -> tuple[dict, str | None]:
    event_type = body.get("type")
    if event_type not in VALID_TYPES:
        return {}, "type must be 'pageview' or 'click'"

    path, err = _clean_path(body.get("path"))
    if err:
        return {}, err

    label = body.get("label")
    if event_type == "click":
        if not isinstance(label, str) or not label or len(label) > MAX_LABEL:
            return {}, f"label is required for click events, max {MAX_LABEL} chars"
    elif label is not None:
        return {}, "label must be absent for pageview events"

    ambient = body.get("ambient", False)
    if not isinstance(ambient, bool):
        return {}, "ambient must be a boolean"

    return {
        "event_type": event_type,
        "path": path,
        "label": label if event_type == "click" else None,
        "ambient": ambient,
    }, None


def _parse_body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    return json.loads(raw)


def lambda_handler(event, context):
    try:
        body = _parse_body(event)
        if not isinstance(body, dict):
            emit(EventsRejected=1)
            return _resp(400, {"error": "body must be a JSON object"})

        parsed, err = _validate(body)
        if err:
            emit(EventsRejected=1)
            return _resp(400, {"error": err})

        doc = {
            "event_type": parsed["event_type"],
            "path": parsed["path"],
            "referrer_host": _referrer_host(body.get("referrer"), _own_host(event)),
            "label": parsed["label"],
            "ambient": parsed["ambient"],
            **_geo(event),
            "visitor_hash": _visitor_hash(event),
            "received_at": datetime.now(UTC).isoformat(),
        }

        pacific_date = datetime.now(SOUND_TZ).date().isoformat()
        key = f"raw/site_events/dt={pacific_date}/{context.aws_request_id}.json"
        boto3.client("s3").put_object(
            Bucket=os.environ["RAW_BUCKET"],
            Key=key,
            Body=json.dumps(doc).encode(),
            ContentType="application/json",
        )
        emit(EventsCollected=1)
        return _resp(204)
    except Exception as exc:
        # No upstream retry/DLQ, and this endpoint is public - a client
        # sending garbage must 400, never 500 and never page anyone.
        print(json.dumps({"EventsCollectorError": {"error": str(exc)}}))
        emit(EventsRejected=1)
        return _resp(400, {"error": "bad request"})
