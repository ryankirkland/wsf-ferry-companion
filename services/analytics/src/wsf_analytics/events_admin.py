"""Site-analytics admin read API (F6 D3): serves the precomputed private
JSON that events_stats.py publishes. No Athena/Glue access from here -
this Lambda only reads two S3 prefixes, which keeps both the attack
surface and the IAM policy small; if the dashboard ever needs a live
query, that is a different Lambda with a different, wider policy.

Authorization comes from the Cognito JWT authorizer, which has already
validated the token - this handler only reads claims (same pattern as
wsf_notify.api._claims), and the "Admins" group check runs before
anything else touches S3, so an unauthorized caller never gets a chance
to observe even the shape of a response.
"""

import json
import os
import re
from datetime import UTC, date, datetime, timedelta

import boto3
from botocore.exceptions import ClientError

DAILY_PREFIX = "analytics/site_events_daily/"
MONTHLY_PREFIX = "analytics/site_events_monthly/"
MAX_RANGE_DAYS = 92  # bounds S3 GETs per request; a dashboard has no
# reason to need more than ~3 months at once, and if that changes it's a
# follow-up, not a silent unbounded loop here.
MERGE_LIMIT = 50

_GROUP_SPLIT_RE = re.compile(r"[,\s]+")


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def _is_admin(event: dict) -> bool:
    claims = (
        (event.get("requestContext") or {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    )
    groups = claims.get("cognito:groups", "")
    if isinstance(groups, list):
        return "Admins" in groups
    if not isinstance(groups, str) or not groups:
        return False
    # HTTP API JWT authorizers hand this claim back as either a
    # JSON-array-shaped string ('["Admins","X"]') or a space/comma
    # separated string, depending on the token - be tolerant of both.
    try:
        parsed = json.loads(groups)
        if isinstance(parsed, list):
            return "Admins" in parsed
    except ValueError:
        pass
    return "Admins" in _GROUP_SPLIT_RE.split(groups)


def _days_in_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _months_in_range(start: date, end: date) -> list[str]:
    months = []
    cur = start.replace(day=1)
    while cur <= end:
        months.append(cur.strftime("%Y-%m"))
        cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
    return months


def _get_json(s3, bucket: str, key: str) -> dict | None:
    try:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    except ClientError as exc:
        # A day/month with no summary yet (today, or before this feature
        # existed) is expected, not an error - the caller tracks it in
        # missing_days/missing_months instead of a silent zero.
        if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            return None
        raise
    return json.loads(body)


def _merge_breakdown(docs: list[dict], field: str, key_fields: tuple[str, ...]) -> list[dict]:
    totals: dict[tuple, dict] = {}
    for doc in docs:
        for row in doc.get(field, []):
            k = tuple(row.get(f) for f in key_fields)
            if k in totals:
                totals[k]["count"] += row["count"]
            else:
                totals[k] = dict(row)
    return sorted(totals.values(), key=lambda r: r["count"], reverse=True)[:MERGE_LIMIT]


def lambda_handler(event, context):
    if not _is_admin(event):
        return _resp(403, {"error": "not authorized"})

    params = event.get("queryStringParameters") or {}
    from_str, to_str = params.get("from"), params.get("to")
    try:
        start = date.fromisoformat(from_str)
        end = date.fromisoformat(to_str)
    except (TypeError, ValueError):
        return _resp(400, {"error": "from and to are required query params, YYYY-MM-DD"})
    if end < start:
        return _resp(400, {"error": "to must not be before from"})
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        return _resp(400, {"error": f"range may not exceed {MAX_RANGE_DAYS} days"})

    s3 = boto3.client("s3")
    bucket = os.environ["RAW_BUCKET"]

    by_day = []
    missing_days = []
    daily_docs = []
    for day in _days_in_range(start, end):
        day_str = day.isoformat()
        doc = _get_json(s3, bucket, f"{DAILY_PREFIX}dt={day_str}.json")
        if doc is None:
            missing_days.append(day_str)
            continue
        daily_docs.append(doc)
        by_day.append(
            {
                "date": day_str,
                "pageviews": doc.get("pageviews", 0),
                "ambient_pageviews": doc.get("ambient_pageviews", 0),
                "clicks": doc.get("clicks", 0),
            }
        )

    by_month = []
    missing_months = []
    for month_str in _months_in_range(start, end):
        doc = _get_json(s3, bucket, f"{MONTHLY_PREFIX}month={month_str}.json")
        if doc is None:
            missing_months.append(month_str)
            continue
        by_month.append(
            {
                "month": month_str,
                "unique_visitors": doc.get("unique_visitors", 0),
                "returning_visitors": doc.get("returning_visitors", 0),
                "days_covered": doc.get("days_covered", 0),
            }
        )

    return _resp(
        200,
        {
            "v": 1,
            "generated_at": datetime.now(UTC).isoformat(),
            "range": {"from": start.isoformat(), "to": end.isoformat()},
            "by_day": by_day,
            "by_month": by_month,
            "top_pages": _merge_breakdown(daily_docs, "by_path", ("path",)),
            "top_clicks": _merge_breakdown(daily_docs, "by_click_label", ("label",)),
            "referrers": _merge_breakdown(daily_docs, "by_referrer", ("source",)),
            "geo": _merge_breakdown(daily_docs, "by_geo", ("country", "region", "city")),
            "missing_days": missing_days,
            "missing_months": missing_months,
        },
    )
