"""events_admin.py: the Cognito-gated read API over the private daily/
monthly JSON that events_stats.py publishes.

The "Admins" group check must run before anything else, including S3
access - an unauthorized caller must not be able to observe even the
shape of a response, so the 403-path test asserts boto3.client is never
called.
"""

import json

from wsf_analytics import events_admin

RAW_BUCKET = "wsf-test-raw"


def _event(claims=None, params=None):
    return {
        "requestContext": {"authorizer": {"jwt": {"claims": claims or {}}}},
        "queryStringParameters": params or {},
    }


def _admin_event(params=None):
    return _event({"cognito:groups": "Admins"}, params)


def _put_daily(aws, day: str, **overrides):
    doc = {
        "v": 1,
        "generated_at": "2026-08-01T00:00:00+00:00",
        "date": day,
        "pageviews": 10,
        "ambient_pageviews": 1,
        "clicks": 2,
        "by_path": [{"path": "/", "count": 10}],
        "by_click_label": [{"label": "subscribe-cta", "count": 2}],
        "by_referrer": [{"source": "direct", "count": 10}],
        "by_geo": [{"country": "US", "region": "WA", "city": "Seattle", "count": 10}],
        **overrides,
    }
    aws["s3"].put_object(
        Bucket=RAW_BUCKET,
        Key=f"analytics/site_events_daily/dt={day}.json",
        Body=json.dumps(doc).encode(),
    )
    return doc


def _put_monthly(aws, month: str, **overrides):
    doc = {
        "v": 1,
        "generated_at": "2026-08-01T00:00:00+00:00",
        "month": month,
        "unique_visitors": 50,
        "returning_visitors": 5,
        "days_covered": 10,
        **overrides,
    }
    aws["s3"].put_object(
        Bucket=RAW_BUCKET,
        Key=f"analytics/site_events_monthly/month={month}.json",
        Body=json.dumps(doc).encode(),
    )
    return doc


def test_403_when_admins_group_absent(aws):
    resp = events_admin.lambda_handler(
        _event({"cognito:groups": "Users"}, {"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 403
    assert json.loads(resp["body"]) == {"error": "not authorized"}


def test_403_when_claim_missing_entirely(aws):
    resp = events_admin.lambda_handler(
        _event({}, {"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 403


def test_403_runs_before_any_s3_access(aws, monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("must not touch AWS before the group check")

    monkeypatch.setattr(events_admin.boto3, "client", boom)
    resp = events_admin.lambda_handler(
        _event({"cognito:groups": "Users"}, {"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 403


def test_admin_group_as_plain_list(aws):
    _put_daily(aws, "2026-08-01")
    resp = events_admin.lambda_handler(
        _event({"cognito:groups": ["Admins"]}, {"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 200


def test_admin_group_as_json_array_shaped_string(aws):
    _put_daily(aws, "2026-08-01")
    resp = events_admin.lambda_handler(
        _event(
            {"cognito:groups": '["Users","Admins"]'}, {"from": "2026-08-01", "to": "2026-08-01"}
        ),
        None,
    )
    assert resp["statusCode"] == 200


def test_admin_group_as_space_separated_string(aws):
    _put_daily(aws, "2026-08-01")
    resp = events_admin.lambda_handler(
        _event({"cognito:groups": "Users Admins"}, {"from": "2026-08-01", "to": "2026-08-01"}),
        None,
    )
    assert resp["statusCode"] == 200


def test_group_check_is_case_sensitive(aws):
    resp = events_admin.lambda_handler(
        _event({"cognito:groups": "admins"}, {"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 403


def test_missing_or_malformed_date_params_400(aws):
    for params in ({}, {"from": "2026-08-01"}, {"from": "not-a-date", "to": "2026-08-01"}):
        resp = events_admin.lambda_handler(_admin_event(params), None)
        assert resp["statusCode"] == 400, params


def test_range_over_92_days_is_rejected(aws):
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-01-01", "to": "2026-06-01"}), None
    )
    assert resp["statusCode"] == 400
    assert "92" in json.loads(resp["body"])["error"]


def test_range_of_exactly_92_days_is_accepted(aws):
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-05-01", "to": "2026-07-31"}), None
    )
    assert resp["statusCode"] == 200


def test_missing_daily_summary_is_skipped_not_raised(aws):
    _put_daily(aws, "2026-08-01")
    # 2026-08-02 has no summary yet (e.g. "today").
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-02"}), None
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["missing_days"] == ["2026-08-02"]
    assert [d["date"] for d in body["by_day"]] == ["2026-08-01"]


def test_missing_monthly_summary_is_skipped_not_raised(aws):
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["missing_months"] == ["2026-08"]
    assert body["by_month"] == []


def test_by_month_populated_when_present(aws):
    _put_monthly(aws, "2026-08")
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    body = json.loads(resp["body"])
    assert body["by_month"] == [
        {"month": "2026-08", "unique_visitors": 50, "returning_visitors": 5, "days_covered": 10}
    ]
    assert body["missing_months"] == []


def test_by_day_and_breakdowns_merge_and_resort_across_days(aws):
    _put_daily(
        aws,
        "2026-08-01",
        pageviews=10,
        by_path=[{"path": "/", "count": 10}, {"path": "/trip/1-2", "count": 5}],
        by_referrer=[{"source": "direct", "count": 10}],
    )
    _put_daily(
        aws,
        "2026-08-02",
        pageviews=20,
        by_path=[{"path": "/", "count": 3}, {"path": "/trip/1-2", "count": 30}],
        by_referrer=[{"source": "direct", "count": 4}, {"source": "google.com", "count": 9}],
    )
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-02"}), None
    )
    body = json.loads(resp["body"])
    assert [d["pageviews"] for d in body["by_day"]] == [10, 20]
    # /trip/1-2 (5+30=35) now outranks / (10+3=13) after merging.
    assert body["top_pages"][0] == {"path": "/trip/1-2", "count": 35}
    assert body["top_pages"][1] == {"path": "/", "count": 13}
    assert body["referrers"][0] == {"source": "direct", "count": 14}


def test_top_lists_are_capped_at_fifty_after_merging(aws):
    by_path = [{"path": f"/junk-{i}", "count": 1} for i in range(80)]
    _put_daily(aws, "2026-08-01", by_path=by_path)
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    body = json.loads(resp["body"])
    assert len(body["top_pages"]) == 50


def test_response_carries_the_normalized_range(aws):
    _put_daily(aws, "2026-08-01")
    resp = events_admin.lambda_handler(
        _admin_event({"from": "2026-08-01", "to": "2026-08-01"}), None
    )
    body = json.loads(resp["body"])
    assert body["range"] == {"from": "2026-08-01", "to": "2026-08-01"}
    assert body["v"] == 1
