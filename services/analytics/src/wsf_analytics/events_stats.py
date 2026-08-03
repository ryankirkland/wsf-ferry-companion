"""Site-analytics nightly aggregator (F6 D2): site_events (Athena/Glue,
partition-projected by dt - no MSCK REPAIR/crawler needed) -> two private
JSON contracts under RAW_BUCKET. Both stay OFF any CloudFront-served/
public data bucket - that bucket already blocks public ACLs, and writing
these there would defeat the whole point of gating the admin dashboard
behind Cognito.

One nightly schedule (no upstream Lambda chains into this one) recomputes:
- yesterday's (Pacific) daily summary, same-key overwrite, idempotent -
  no catch-up cron the way F4's stats need one, since a single nightly
  run covering the trailing day is sufficient.
- the CURRENT Pacific month's rolling rollup, so unique/returning visitor
  counts stay fresh as the month progresses rather than only updating
  once the month closes.
- on the 1st of the month only, a one-time finalizing overwrite of the
  month that just closed, over its full (now fully-elapsed) date range -
  otherwise that month's last rolling write, made on its own final night,
  would permanently understate its own last day forever.

Unique/returning visitor queries exclude ambient (wall-tablet) traffic -
a `/ambient` session running for hours/days would otherwise dominate and
misrepresent "how many people visit."
"""

import json
import os
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import boto3

from wsf_analytics.athena import Athena
from wsf_analytics.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
DAILY_PREFIX = "analytics/site_events_daily/"
MONTHLY_PREFIX = "analytics/site_events_monthly/"

# Defensive cap on cardinality, not a real limit at this traffic scale -
# a bot sending thousands of distinct junk paths must not blow up the
# daily JSON or the query cost.
BREAKDOWN_LIMIT = 50


def _publish(s3, bucket: str, key: str, doc: dict) -> None:
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(doc, separators=(",", ":")).encode(),
        ContentType="application/json",
    )


def _totals(day: str) -> str:
    return f"""
    SELECT
      count(*) FILTER (WHERE event_type = 'pageview') AS pageviews,
      count(*) FILTER (WHERE event_type = 'pageview' AND ambient) AS ambient_pageviews,
      count(*) FILTER (WHERE event_type = 'click') AS clicks
    FROM site_events WHERE dt = DATE '{day}'"""


def _by_path(day: str) -> str:
    return f"""
    SELECT path, count(*) AS count FROM site_events
    WHERE dt = DATE '{day}' AND event_type = 'pageview'
    GROUP BY 1 ORDER BY count DESC LIMIT {BREAKDOWN_LIMIT}"""


def _by_click_label(day: str) -> str:
    return f"""
    SELECT label, count(*) AS count FROM site_events
    WHERE dt = DATE '{day}' AND event_type = 'click'
    GROUP BY 1 ORDER BY count DESC LIMIT {BREAKDOWN_LIMIT}"""


def _by_referrer(day: str) -> str:
    return f"""
    SELECT referrer_host AS source, count(*) AS count FROM site_events
    WHERE dt = DATE '{day}'
    GROUP BY 1 ORDER BY count DESC LIMIT {BREAKDOWN_LIMIT}"""


def _by_geo(day: str) -> str:
    return f"""
    SELECT country, region, city, count(*) AS count FROM site_events
    WHERE dt = DATE '{day}'
    GROUP BY 1, 2, 3 ORDER BY count DESC LIMIT {BREAKDOWN_LIMIT}"""


def _monthly_totals(since: str, through: str) -> str:
    # NOT ambient: a wall tablet polling for hours/days must not count as a
    # unique or returning visitor - see docs/features/site-analytics.md.
    return f"""
    SELECT count(DISTINCT visitor_hash) AS unique_visitors,
           count(DISTINCT dt) AS days_covered
    FROM site_events WHERE dt BETWEEN DATE '{since}' AND DATE '{through}' AND NOT ambient"""


def _returning_visitors(since: str, through: str) -> str:
    return f"""
    SELECT count(*) AS returning_visitors FROM (
      SELECT visitor_hash FROM site_events
      WHERE dt BETWEEN DATE '{since}' AND DATE '{through}' AND NOT ambient
      GROUP BY visitor_hash HAVING count(DISTINCT dt) >= 2
    )"""


def lambda_handler(event, context):
    raw_bucket = os.environ["RAW_BUCKET"]
    s3 = boto3.client("s3")
    athena = Athena(
        database=os.environ.get("GLUE_DATABASE", "wsf_prod_analytics"),
        workgroup=os.environ.get("ATHENA_WORKGROUP", "wsf-prod-analytics"),
    )

    today = datetime.now(SOUND_TZ).date()
    day_str = (today - timedelta(days=1)).isoformat()
    generated_at = datetime.now(UTC).isoformat()

    (totals,) = athena.query(_totals(day_str))
    by_path = athena.query(_by_path(day_str))
    by_click_label = athena.query(_by_click_label(day_str))
    by_referrer = athena.query(_by_referrer(day_str))
    by_geo = athena.query(_by_geo(day_str))

    daily = {
        "v": 1,
        "generated_at": generated_at,
        "date": day_str,
        "pageviews": totals["pageviews"] or 0,
        "ambient_pageviews": totals["ambient_pageviews"] or 0,
        "clicks": totals["clicks"] or 0,
        "by_path": [{"path": r["path"], "count": r["count"]} for r in by_path],
        "by_click_label": [{"label": r["label"], "count": r["count"]} for r in by_click_label],
        "by_referrer": [{"source": r["source"], "count": r["count"]} for r in by_referrer],
        "by_geo": [
            {
                "country": r["country"],
                "region": r["region"],
                "city": r["city"],
                "count": r["count"],
            }
            for r in by_geo
        ],
    }
    _publish(s3, raw_bucket, f"{DAILY_PREFIX}dt={day_str}.json", daily)

    month_str = today.strftime("%Y-%m")
    month_start = today.replace(day=1).isoformat()
    (month_totals,) = athena.query(_monthly_totals(month_start, today.isoformat()))
    (returning,) = athena.query(_returning_visitors(month_start, today.isoformat()))

    monthly = {
        "v": 1,
        "generated_at": generated_at,
        "month": month_str,
        "unique_visitors": month_totals["unique_visitors"] or 0,
        "returning_visitors": returning["returning_visitors"] or 0,
        "days_covered": month_totals["days_covered"] or 0,
    }
    _publish(s3, raw_bucket, f"{MONTHLY_PREFIX}month={month_str}.json", monthly)

    if today.day == 1:
        # The month that just ended had its last rolling write on its own
        # final night, covering that day only midnight-to-run-time - the
        # same partial-day gap the daily rollup avoids by always waiting
        # for "yesterday" to fully elapse. Now that day has fully elapsed,
        # so close the book on that month with one finalizing overwrite.
        closed_end = today - timedelta(days=1)
        closed_start = closed_end.replace(day=1)
        closed_str = closed_end.strftime("%Y-%m")
        (closed_totals,) = athena.query(
            _monthly_totals(closed_start.isoformat(), closed_end.isoformat())
        )
        (closed_returning,) = athena.query(
            _returning_visitors(closed_start.isoformat(), closed_end.isoformat())
        )
        closed_monthly = {
            "v": 1,
            "generated_at": generated_at,
            "month": closed_str,
            "unique_visitors": closed_totals["unique_visitors"] or 0,
            "returning_visitors": closed_returning["returning_visitors"] or 0,
            "days_covered": closed_totals["days_covered"] or 0,
        }
        _publish(s3, raw_bucket, f"{MONTHLY_PREFIX}month={closed_str}.json", closed_monthly)

    counts = {
        "EventsStatsPublished": 1,
        "EventsStatsDailyPageviews": daily["pageviews"],
        "EventsStatsDailyClicks": daily["clicks"],
        "EventsStatsMonthlyUniqueVisitors": monthly["unique_visitors"],
        "EventsStatsBytesScanned": athena.bytes_scanned,
    }
    emit(**counts)
    print(json.dumps({"EventsStats": {**counts, "date": day_str, "month": month_str}}))
    return counts
