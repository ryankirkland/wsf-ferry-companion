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


def test_visitor_identity_queries_exclude_ambient_traffic():
    # A wall tablet left on for hours/days must not inflate unique/returning
    # visitor counts - see docs/features/site-analytics.md.
    assert "NOT ambient" in events_stats._monthly_totals("2026-08-01", "2026-08-31")
    assert "NOT ambient" in events_stats._returning_visitors("2026-08-01", "2026-08-31")


def test_queries_compare_dt_as_a_string_never_a_date_literal():
    # The Glue partition column dt is a STRING; Athena statically rejects
    # varchar = date with TYPE_MISMATCH, which killed every nightly run from
    # 2026-08-04 to 2026-08-14 (the tests mock Athena, so only prod ran the
    # SQL). ISO date strings compare correctly lexicographically, including
    # in BETWEEN. Guard every query builder against the literal coming back.
    queries = [
        events_stats._totals("2026-08-14"),
        events_stats._by_path("2026-08-14"),
        events_stats._by_click_label("2026-08-14"),
        events_stats._by_referrer("2026-08-14"),
        events_stats._by_geo("2026-08-14"),
        events_stats._monthly_totals("2026-08-01", "2026-08-31"),
        events_stats._returning_visitors("2026-08-01", "2026-08-31"),
    ]
    for q in queries:
        assert "DATE '" not in q, q


def test_monthly_days_covered_counts_every_day_not_just_non_ambient_days():
    # days_covered answers "how far has this aggregation window progressed,"
    # not "how many days had non-ambient traffic" - the ambient exclusion
    # must be scoped to the unique_visitors FILTER only. If it leaked into
    # the shared WHERE clause instead, a day with zero human traffic
    # (plausible for a low-traffic personal site with an always-on wall
    # tablet) would silently drop out of days_covered and understate how
    # much of the month the summary actually spans.
    sql = events_stats._monthly_totals("2026-08-01", "2026-08-31")
    assert "count(DISTINCT visitor_hash) FILTER (WHERE NOT ambient)" in sql
    where_clause = sql.split("FROM site_events")[1]
    assert "ambient" not in where_clause


class RangeAwareAthena:
    """Fake Athena that dispatches on query kind (totals/returning/other)
    AND on the DATE bounds embedded in the SQL, so a test can tell apart
    the current-month rolling query from the closed-month finalizing query
    - both share the same query shape as FakeAthena's key, but must cover
    different date ranges."""

    def __init__(self, rows_by_key, **_):
        self.rows_by_key = rows_by_key
        self.bytes_scanned = 100
        self.seen = []

    def query(self, sql: str):
        self.seen.append(sql)
        if "unique_visitors" in sql:
            kind = "totals"
        elif "returning_visitors" in sql:
            kind = "returning"
        elif "pageviews" in sql:
            return [{"pageviews": 0, "ambient_pageviews": 0, "clicks": 0}]
        else:
            return []
        for (k, since, through), rows in self.rows_by_key.items():
            if k == kind and f"'{since}'" in sql and f"'{through}'" in sql:
                return rows
        return (
            [{"unique_visitors": 0, "days_covered": 0}]
            if kind == "totals"
            else [{"returning_visitors": 0}]
        )


def test_the_first_of_the_month_finalizes_the_month_that_just_closed(aws, monkeypatch):
    # Sept 1 2026 - August (31 days) just closed. Its last rolling write,
    # made the night of Aug 31, only covered midnight-to-run-time. This run
    # must overwrite August's file with the complete month, using Aug 31 -
    # now fully elapsed - as the upper bound, while still publishing
    # September's fresh (intentionally partial) rolling file too.
    fixed_pacific = datetime(2026, 9, 1, 4, 10, tzinfo=events_stats.SOUND_TZ)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_pacific if tz is events_stats.SOUND_TZ else datetime.now(tz)

    monkeypatch.setattr(events_stats, "datetime", FixedDatetime)

    holder = {}

    def factory(**kwargs):
        holder["athena"] = RangeAwareAthena(
            {
                ("totals", "2026-08-01", "2026-08-31"): [
                    {"unique_visitors": 77, "days_covered": 31}
                ],
                ("returning", "2026-08-01", "2026-08-31"): [{"returning_visitors": 12}],
                ("totals", "2026-09-01", "2026-09-01"): [{"unique_visitors": 3, "days_covered": 1}],
                ("returning", "2026-09-01", "2026-09-01"): [{"returning_visitors": 0}],
            },
            **kwargs,
        )
        return holder["athena"]

    monkeypatch.setattr(events_stats, "Athena", factory)

    events_stats.lambda_handler({}, None)

    closed = read_json(aws, "wsf-test-raw", "analytics/site_events_monthly/month=2026-08.json")
    assert closed["month"] == "2026-08"
    assert closed["unique_visitors"] == 77
    assert closed["returning_visitors"] == 12
    assert closed["days_covered"] == 31

    current = read_json(aws, "wsf-test-raw", "analytics/site_events_monthly/month=2026-09.json")
    assert current["month"] == "2026-09"
    assert current["unique_visitors"] == 3
    assert current["returning_visitors"] == 0
    assert current["days_covered"] == 1


def test_mid_month_runs_do_not_touch_the_prior_month(aws, monkeypatch):
    fixed_pacific = datetime(2026, 9, 15, 4, 10, tzinfo=events_stats.SOUND_TZ)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_pacific if tz is events_stats.SOUND_TZ else datetime.now(tz)

    monkeypatch.setattr(events_stats, "datetime", FixedDatetime)
    install(monkeypatch, BASE_ROWS)

    events_stats.lambda_handler({}, None)

    objects = (
        aws["s3"]
        .list_objects_v2(Bucket="wsf-test-raw", Prefix="analytics/site_events_monthly/")
        .get("Contents", [])
    )
    keys = {o["Key"] for o in objects}
    assert keys == {"analytics/site_events_monthly/month=2026-09.json"}
