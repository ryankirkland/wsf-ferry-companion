"""events_stats.py: the nightly site_events aggregator.

Follows the same fake-Athena-dispatching-on-query-shape approach as
test_stats.py - the SQL itself is exercised against real Athena in the
deployed verification, not here.
"""

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from wsf_analytics import events_stats

SOUND_TZ = ZoneInfo("America/Los_Angeles")


class FakeAthena:
    def __init__(self, rows: dict, **_):
        self.rows = rows
        self.bytes_scanned = 4242
        self.seen = []

    def query(self, sql: str):
        key = _key_for(sql)
        self.seen.append((key, sql))
        return self.rows.get(key, [])


def _key_for(sql: str) -> str:
    if "unique_visitors" in sql:
        return "monthly_totals"
    if "returning_visitors" in sql:
        return "returning"
    if "SELECT path," in sql:
        return "by_path"
    if "SELECT label," in sql:
        return "by_click_label"
    if "referrer_host AS source" in sql:
        return "by_referrer"
    if "country, region, city" in sql:
        return "by_geo"
    if "pageviews" in sql:
        return "totals"
    raise AssertionError(f"unrecognized query shape: {sql}")


def install(monkeypatch, rows):
    holder = {}

    def factory(**kwargs):
        holder["athena"] = FakeAthena(rows, **kwargs)
        return holder["athena"]

    monkeypatch.setattr(events_stats, "Athena", factory)
    return holder


BASE_ROWS = {
    "totals": [{"pageviews": 143, "ambient_pageviews": 12, "clicks": 21}],
    "by_path": [{"path": "/", "count": 80}, {"path": "/trip/7-8", "count": 40}],
    "by_click_label": [{"label": "subscribe-cta", "count": 9}],
    "by_referrer": [{"source": "direct", "count": 90}, {"source": "google.com", "count": 30}],
    "by_geo": [{"country": "US", "region": "WA", "city": "Seattle", "count": 100}],
    "monthly_totals": [{"unique_visitors": 340, "days_covered": 3}],
    "returning": [{"returning_visitors": 58}],
}

EMPTY_ROWS = {
    "totals": [{"pageviews": 0, "ambient_pageviews": 0, "clicks": 0}],
    "by_path": [],
    "by_click_label": [],
    "by_referrer": [],
    "by_geo": [],
    "monthly_totals": [{"unique_visitors": 0, "days_covered": 0}],
    "returning": [{"returning_visitors": 0}],
}


def read_json(aws, bucket, key):
    return json.loads(aws["s3"].get_object(Bucket=bucket, Key=key)["Body"].read())


def _yesterday() -> str:
    return (datetime.now(SOUND_TZ).date() - timedelta(days=1)).isoformat()


def _current_month() -> str:
    return datetime.now(SOUND_TZ).strftime("%Y-%m")


def test_publishes_daily_summary_for_yesterday_pacific(aws, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    result = events_stats.lambda_handler({}, None)
    assert result["EventsStatsPublished"] == 1

    daily = read_json(aws, "wsf-test-raw", f"analytics/site_events_daily/dt={_yesterday()}.json")
    assert daily["v"] == 1
    assert daily["date"] == _yesterday()
    assert daily["pageviews"] == 143
    assert daily["ambient_pageviews"] == 12
    assert daily["clicks"] == 21
    assert daily["by_path"] == [{"path": "/", "count": 80}, {"path": "/trip/7-8", "count": 40}]
    assert daily["by_click_label"] == [{"label": "subscribe-cta", "count": 9}]
    assert daily["by_referrer"] == [
        {"source": "direct", "count": 90},
        {"source": "google.com", "count": 30},
    ]
    assert daily["by_geo"] == [{"country": "US", "region": "WA", "city": "Seattle", "count": 100}]


def test_publishes_monthly_rollup_for_the_current_pacific_month(aws, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    events_stats.lambda_handler({}, None)

    monthly = read_json(
        aws, "wsf-test-raw", f"analytics/site_events_monthly/month={_current_month()}.json"
    )
    assert monthly["v"] == 1
    assert monthly["month"] == _current_month()
    assert monthly["unique_visitors"] == 340
    assert monthly["returning_visitors"] == 58
    assert monthly["days_covered"] == 3


def test_a_quiet_day_publishes_honest_zeros_not_an_error(aws, monkeypatch):
    install(monkeypatch, EMPTY_ROWS)
    result = events_stats.lambda_handler({}, None)
    assert result["EventsStatsDailyPageviews"] == 0
    daily = read_json(aws, "wsf-test-raw", f"analytics/site_events_daily/dt={_yesterday()}.json")
    assert daily["pageviews"] == 0
    assert daily["by_path"] == []


def test_breakdown_queries_cap_at_the_defensive_limit(aws, monkeypatch):
    holder = install(monkeypatch, BASE_ROWS)
    events_stats.lambda_handler({}, None)
    breakdown_keys = {"by_path", "by_click_label", "by_referrer", "by_geo"}
    checked = 0
    for key, sql in holder["athena"].seen:
        if key in breakdown_keys:
            assert f"LIMIT {events_stats.BREAKDOWN_LIMIT}" in sql
            checked += 1
    assert checked == len(breakdown_keys)  # every breakdown query actually ran and was checked


def test_never_writes_under_the_public_data_bucket(aws, monkeypatch):
    # This dataset is private - it must never land under the
    # CloudFront-served/public data bucket, only RAW_BUCKET.
    install(monkeypatch, BASE_ROWS)
    events_stats.lambda_handler({}, None)
    objects = aws["s3"].list_objects_v2(Bucket="wsf-test-data").get("Contents", [])
    assert not any(o["Key"].startswith("analytics/") for o in objects)
