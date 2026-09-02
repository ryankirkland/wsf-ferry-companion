"""events.py: the public site-analytics beacon collector.

Privacy is the load-bearing property under test here - the raw IP must
never reach the object written to S3, in any field, at any point - plus
the validation/derivation rules that make the collector safe to leave
open to the public internet.
"""

import hashlib
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from wsf_analytics import events


class Ctx:
    aws_request_id = "req-abc-123"


def _event(body, headers=None, source_ip="203.0.113.9"):
    return {
        "headers": {"user-agent": "pytest-agent", "host": "soundferries.com", **(headers or {})},
        "body": json.dumps(body),
        "requestContext": {"http": {"sourceIp": source_ip}},
    }


def _written_doc(aws):
    objs = (
        aws["s3"]
        .list_objects_v2(Bucket="wsf-test-raw", Prefix="raw/site_events/")
        .get("Contents", [])
    )
    assert len(objs) == 1
    body = aws["s3"].get_object(Bucket="wsf-test-raw", Key=objs[0]["Key"])["Body"].read()
    return json.loads(body)


def test_pageview_is_collected_with_geo_headers(aws):
    resp = events.lambda_handler(
        _event(
            {"type": "pageview", "path": "/trip/7-8"},
            headers={
                "cloudfront-viewer-country": "US",
                "cloudfront-viewer-country-region": "WA",
                "cloudfront-viewer-city": "Seattle",
            },
        ),
        Ctx(),
    )
    assert resp["statusCode"] == 204
    assert resp["body"] == ""
    doc = _written_doc(aws)
    assert doc["event_type"] == "pageview"
    assert doc["path"] == "/trip/7-8"
    assert (doc["country"], doc["region"], doc["city"]) == ("US", "WA", "Seattle")


def test_missing_geo_headers_degrade_to_unknown_not_an_exception(aws):
    resp = events.lambda_handler(_event({"type": "pageview", "path": "/"}), Ctx())
    assert resp["statusCode"] == 204
    doc = _written_doc(aws)
    assert (doc["country"], doc["region"], doc["city"]) == ("unknown", "unknown", "unknown")


def test_a_spoofed_leading_forwarded_hop_cannot_mint_visitors(aws):
    """ADR-0007 assumed CloudFront SETS X-Forwarded-For. It APPENDS to it,
    so the leftmost hop is whatever the client sent - and this route is
    reachable directly at the API domain with CloudFront out of the path.
    Trusting the first hop let anyone mint unlimited distinct visitors."""
    real = "70.41.3.18"
    event = _event(
        {"type": "pageview", "path": "/"},
        headers={"x-forwarded-for": f"1.2.3.4, {real}"},
        source_ip="10.0.0.1",
    )
    events.lambda_handler(event, Ctx())
    doc = _written_doc(aws)
    month = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m")
    spoofed = hashlib.sha256(f"{month}:1.2.3.4:pytest-agent".encode()).hexdigest()[:16]
    honest = hashlib.sha256(f"{month}:{real}:pytest-agent".encode()).hexdigest()[:16]
    assert doc["visitor_hash"] != spoofed, "the client-supplied hop must not decide identity"
    assert doc["visitor_hash"] == honest


def test_cloudfront_viewer_address_wins_over_forwarded_for(aws):
    event = _event(
        {"type": "pageview", "path": "/"},
        headers={
            "cloudfront-viewer-address": "198.51.100.7:51234",
            "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        },
        source_ip="10.0.0.1",
    )
    events.lambda_handler(event, Ctx())
    doc = _written_doc(aws)
    month = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m")
    expected = hashlib.sha256(f"{month}:198.51.100.7:pytest-agent".encode()).hexdigest()[:16]
    assert doc["visitor_hash"] == expected, "the edge-set header is the trustworthy one"


def test_forged_geo_headers_are_rejected_not_stored(aws):
    """These land in S3, Athena and the admin dashboard's geo breakdown."""
    event = _event(
        {"type": "pageview", "path": "/"},
        headers={
            "cloudfront-viewer-country": "NOT-A-COUNTRY-CODE",
            "cloudfront-viewer-country-region": "<script>alert(1)</script>",
            "cloudfront-viewer-city": "x" * 500,
        },
    )
    events.lambda_handler(event, Ctx())
    doc = _written_doc(aws)
    assert (doc["country"], doc["region"], doc["city"]) == ("unknown", "unknown", "unknown")


def test_ordinary_geo_headers_still_pass_through(aws):
    event = _event(
        {"type": "pageview", "path": "/"},
        headers={
            "cloudfront-viewer-country": "US",
            "cloudfront-viewer-country-region": "WA",
            "cloudfront-viewer-city": "Port Orchard",
        },
    )
    events.lambda_handler(event, Ctx())
    doc = _written_doc(aws)
    assert (doc["country"], doc["region"], doc["city"]) == ("US", "WA", "Port Orchard")


def test_source_ip_is_used_only_when_x_forwarded_for_is_absent(aws):
    event = _event({"type": "pageview", "path": "/"}, source_ip="10.0.0.1")
    events.lambda_handler(event, Ctx())
    doc = _written_doc(aws)
    month = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m")
    expected = hashlib.sha256(f"{month}:10.0.0.1:pytest-agent".encode()).hexdigest()[:16]
    assert doc["visitor_hash"] == expected


def test_raw_ip_never_appears_anywhere_in_the_written_body(aws):
    events.lambda_handler(
        _event(
            {"type": "pageview", "path": "/"},
            headers={"x-forwarded-for": "198.51.100.42, 70.41.3.18"},
        ),
        Ctx(),
    )
    doc = _written_doc(aws)
    raw = json.dumps(doc)
    for ip_fragment in ("198.51.100.42", "70.41.3.18", "203.0.113.9"):
        assert ip_fragment not in raw
    # Only the 16-char hex digest should represent the visitor.
    assert doc["visitor_hash"] != "198.51.100.42"
    assert len(doc["visitor_hash"]) == 16


def test_query_string_and_fragment_are_stripped_from_path(aws):
    events.lambda_handler(
        _event({"type": "pageview", "path": "/confirm?token=super-secret#section"}), Ctx()
    )
    doc = _written_doc(aws)
    assert doc["path"] == "/confirm"
    assert "token" not in json.dumps(doc)


def test_referrer_reduces_to_hostname_only(aws):
    events.lambda_handler(
        _event(
            {"type": "pageview", "path": "/", "referrer": "https://www.reddit.com/r/wsf?x=1#top"}
        ),
        Ctx(),
    )
    assert _written_doc(aws)["referrer_host"] == "www.reddit.com"


def test_missing_referrer_is_direct(aws):
    events.lambda_handler(_event({"type": "pageview", "path": "/"}), Ctx())
    assert _written_doc(aws)["referrer_host"] == "direct"


def test_unparseable_referrer_is_direct(aws):
    events.lambda_handler(_event({"type": "pageview", "path": "/", "referrer": "not-a-url"}), Ctx())
    assert _written_doc(aws)["referrer_host"] == "direct"


def test_same_origin_referrer_is_direct(aws):
    events.lambda_handler(
        _event(
            {"type": "pageview", "path": "/", "referrer": "https://soundferries.com/trip/1-2"},
            headers={"host": "soundferries.com"},
        ),
        Ctx(),
    )
    assert _written_doc(aws)["referrer_host"] == "direct"


def test_click_requires_a_label(aws):
    resp = events.lambda_handler(_event({"type": "click", "path": "/"}), Ctx())
    assert resp["statusCode"] == 400
    assert "label" in json.loads(resp["body"])["error"]


def test_pageview_rejects_a_label(aws):
    resp = events.lambda_handler(
        _event({"type": "pageview", "path": "/", "label": "subscribe-cta"}), Ctx()
    )
    assert resp["statusCode"] == 400


def test_click_with_label_is_collected(aws):
    resp = events.lambda_handler(
        _event({"type": "click", "path": "/", "label": "subscribe-cta"}), Ctx()
    )
    assert resp["statusCode"] == 204
    assert _written_doc(aws)["label"] == "subscribe-cta"


def test_label_over_max_length_is_rejected(aws):
    resp = events.lambda_handler(_event({"type": "click", "path": "/", "label": "x" * 61}), Ctx())
    assert resp["statusCode"] == 400


def test_ambient_defaults_false(aws):
    events.lambda_handler(_event({"type": "pageview", "path": "/"}), Ctx())
    assert _written_doc(aws)["ambient"] is False


def test_ambient_true_is_preserved(aws):
    events.lambda_handler(_event({"type": "pageview", "path": "/ambient", "ambient": True}), Ctx())
    assert _written_doc(aws)["ambient"] is True


def test_invalid_type_is_rejected(aws):
    resp = events.lambda_handler(_event({"type": "impression", "path": "/"}), Ctx())
    assert resp["statusCode"] == 400
    assert "type" in json.loads(resp["body"])["error"]


def test_path_missing_leading_slash_is_rejected(aws):
    resp = events.lambda_handler(_event({"type": "pageview", "path": "trip/1-2"}), Ctx())
    assert resp["statusCode"] == 400


def test_path_over_max_length_is_rejected(aws):
    resp = events.lambda_handler(_event({"type": "pageview", "path": "/" + "a" * 200}), Ctx())
    assert resp["statusCode"] == 400


def test_malformed_json_body_never_500s(aws):
    event = _event({"type": "pageview", "path": "/"})
    event["body"] = "{not json"
    resp = events.lambda_handler(event, Ctx())
    assert resp["statusCode"] == 400


def test_client_timestamp_field_is_ignored_server_time_is_authoritative(aws):
    # The contract has no client-timestamp field at all; even if a client
    # sends one, received_at must come from Lambda execution time.
    events.lambda_handler(
        _event({"type": "pageview", "path": "/", "timestamp": "1999-01-01T00:00:00Z"}), Ctx()
    )
    doc = _written_doc(aws)
    received = datetime.fromisoformat(doc["received_at"])
    assert received.year >= 2026
