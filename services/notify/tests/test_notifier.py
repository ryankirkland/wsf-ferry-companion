from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from conftest import jwt_event
from wsf_notify import api, notifier

# 2:05 PM PST on a fixed winter day.
PUBLISHED = "2026-01-15T22:05:00+00:00"
CANCEL_TEXT = "The 1630 SEA/BBI sailing is cancelled due to crewing."


def alert(id=1001, text=CANCEL_TEXT, published=PUBLISHED, route_ids=(5,), all_routes=False):
    return {
        "id": id,
        "title": "Sea/BI - Service update",
        "text": text,
        "published": published,
        "route_ids": list(route_ids),
        "all_routes": all_routes,
    }


def run(alerts, observed_ms=1_800_000_000_000):
    return notifier.lambda_handler({"observed_at_ms": observed_ms, "alerts": alerts}, None)


def subscribe(sub, email, dep, arr, start, end):
    resp = api.lambda_handler(
        jwt_event(
            "POST /v1/subscriptions",
            sub=sub,
            email=email,
            body={"dep": dep, "arr": arr, "window_start": start, "window_end": end},
        ),
        None,
    )
    assert resp["statusCode"] == 201


@pytest.fixture
def sends(aws, monkeypatch):
    monkeypatch.setenv("FROM_ADDRESS", "Ferry Sound <alerts@ferrysound.com>")
    monkeypatch.setenv("SES_CONFIGURATION_SET", "wsf-test")
    monkeypatch.setenv("API_ORIGIN", "https://api.ferrysound.com")
    notifier._secrets_cache = None
    notifier._index_cache = None
    sent = []
    monkeypatch.setattr(notifier, "_ses_send", lambda to, mime: sent.append((to, mime)))
    return sent


def test_window_matching_on_parsed_sailing(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    subscribe("u-early", "early@example.com", 7, 3, "04:00", "06:00")
    subscribe("u-reverse", "rev@example.com", 3, 7, "16:00", "19:00")

    result = run([alert()])
    assert result["sent"] == 1
    assert [to for to, _ in sends] == ["hit@example.com"]
    mime = sends[0][1].decode()
    assert "Affected sailings in your window" in mime
    assert "16:30 SEA > BBI" in mime
    assert "List-Unsubscribe-Post: List-Unsubscribe=One-Click" in mime
    assert "References: <bulletin-1001@ferrysound.com>" in mime


def test_duplicate_invoke_sends_nothing(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert()])
    result = run([alert()])
    assert result["sent"] == 0 and len(sends) == 1


def test_text_update_resends_up_to_cap(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert(text=CANCEL_TEXT)])
    run([alert(text=CANCEL_TEXT + " Now expected 1700.")])
    run([alert(text=CANCEL_TEXT + " Now expected 1730.")])
    # Third text change: per-bulletin cap (3) already consumed.
    result = run([alert(text=CANCEL_TEXT + " Now expected 1800.")])
    assert len(sends) == 3 and result["sent"] == 0


def test_daily_cap_blocks_sends(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    la_today = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    aws["table"].put_item(Item={"PK": "USER#u-hit", "SK": f"NOTIF#{la_today}", "sends": 10})
    result = run([alert()])
    assert result["sent"] == 0 and sends == []


def test_parse_miss_falls_back_to_publish_window(aws, sends):
    vague = "Sailings may be cancelled throughout the day due to crewing."
    # Published 14:05 Sound time: inside [13:00-2h, 19:00] for the hit sub,
    # outside for the morning sub.
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    subscribe("u-miss", "miss@example.com", 7, 3, "04:00", "06:00")
    result = run([alert(text=vague)])
    assert result["sent"] == 1
    assert sends[0][0] == "hit@example.com"
    assert "couldn't determine the specific sailings" in sends[0][1].decode()


def test_empty_feed_guard_and_gone_marking(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert()])
    # Blip: empty feed with stored bulletins -> guarded, nothing marked.
    guarded = run([])
    assert guarded.get("guarded") is True
    item = aws["table"].get_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})["Item"]
    assert "gone_at" not in item

    # Real disappearance: a different feed without bulletin 1001.
    run([alert(id=2002, text="Terminal status update, no cancellations.")])
    item = aws["table"].get_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})["Item"]
    assert "gone_at" in item
    # Reappearance with identical content: no re-send (claims + unchanged).
    before = len(sends)
    run([alert()])
    assert len(sends) == before


def test_one_bad_recipient_never_aborts_fanout(aws, sends, monkeypatch):
    subscribe("u-bad", "bad@example.com", 7, 3, "16:00", "19:00")
    subscribe("u-good", "good@example.com", 7, 3, "16:00", "19:00")

    def flaky(to, mime):
        if to == "bad@example.com":
            raise RuntimeError("MessageRejected (sandbox unverified)")
        sends.append((to, mime))

    monkeypatch.setattr(notifier, "_ses_send", flaky)
    result = run([alert()])
    assert result["sent"] == 1
    assert [to for to, _ in sends] == ["good@example.com"]


def test_all_routes_alert_reaches_every_route_sub(aws, sends):
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    result = run([alert(route_ids=(), all_routes=True, text="Systemwide notice.")])
    assert result["sent"] == 1  # fallback window rule applies (14:05 in 11:00-19:00)
