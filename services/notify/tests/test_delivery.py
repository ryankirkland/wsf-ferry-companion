import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from botocore.exceptions import ClientError
from wsf_notify import delivery


def payload(*, text_hash="hash-1", observed_at_ms=None, matches=None):
    match = {
        "dep": 7,
        "arr": 3,
        "dep_name": "Seattle",
        "arr_name": "Bainbridge Island",
        "slug": "seattle-bainbridge-island",
    }
    return {
        "v": 1,
        "user_sub": "u-hit",
        "email": "hit@example.com",
        "text_hash": text_hash,
        "observed_at_ms": observed_at_ms or int(time.time() * 1000),
        "alert": {
            "id": 1001,
            "title": "Sea/BI - Service update",
            "text": "The 1630 SEA/BBI sailing is cancelled due to crewing.",
            "published": "2026-01-15T22:05:00+00:00",
            "route_ids": [5],
            "all_routes": False,
        },
        "parsed_clean": True,
        "sailings": [
            {
                "hhmm": "16:30",
                "dep_code": "SEA",
                "arr_code": "BBI",
                "dep_id": 7,
                "arr_id": 3,
            }
        ],
        "subscription_ids": ["0007-0003-1600-1900"],
        "subscription": match,
        "matches": matches or [match],
    }


def event(body: dict) -> dict:
    return {"Records": [{"messageId": "message-1", "body": json.dumps(body)}]}


@pytest.fixture(autouse=True)
def active_subscription(aws):
    aws["table"].put_item(
        Item={
            "PK": "USER#u-hit",
            "SK": "SUB#0007-0003-1600-1900",
            "email": "hit@example.com",
        }
    )


@pytest.fixture
def sends(monkeypatch):
    sent = []
    monkeypatch.setattr(delivery, "_ses_send", lambda to, mime: sent.append((to, mime)))
    return sent


def test_successful_delivery_records_claim_after_ses(aws, sends):
    result = delivery.lambda_handler(event(payload()), None)

    assert result == {"processed": 1, "sent": 1}
    assert [to for to, _ in sends] == ["hit@example.com"]
    claim = aws["table"].get_item(Key={"PK": "USER#u-hit", "SK": "SENT#1001"})["Item"]
    assert claim["last_hash"] == "hash-1"
    assert int(claim["send_count"]) == 1


def test_duplicate_queue_message_sends_only_once(aws, sends):
    message = event(payload())

    delivery.lambda_handler(message, None)
    result = delivery.lambda_handler(message, None)

    assert result == {"processed": 1, "sent": 0}
    assert len(sends) == 1


def test_ses_failure_leaves_delivery_retryable(aws, sends, monkeypatch):
    message = event(payload())
    monkeypatch.setattr(
        delivery,
        "_ses_send",
        lambda to, mime: (_ for _ in ()).throw(RuntimeError("SES unavailable")),
    )

    with pytest.raises(RuntimeError, match="SES unavailable"):
        delivery.lambda_handler(message, None)

    response = aws["table"].get_item(Key={"PK": "USER#u-hit", "SK": "SENT#1001"})
    assert "Item" not in response

    monkeypatch.setattr(delivery, "_ses_send", lambda to, mime: sends.append((to, mime)))
    result = delivery.lambda_handler(message, None)
    assert result["sent"] == 1
    assert len(sends) == 1


def test_transient_claim_failure_retries_instead_of_losing_state(aws, sends, monkeypatch):
    class FailingDynamoDB:
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "TransactionCanceledException", "Message": "retry"}},
                "TransactWriteItems",
            )

    real_client = delivery.boto3.client
    monkeypatch.setattr(
        delivery.boto3,
        "client",
        lambda service: FailingDynamoDB() if service == "dynamodb" else real_client(service),
    )

    with pytest.raises(ClientError):
        delivery.lambda_handler(event(payload()), None)

    assert len(sends) == 1
    assert "Item" not in aws["table"].get_item(Key={"PK": "USER#u-hit", "SK": "SENT#1001"})


def test_unsubscribed_user_is_skipped_before_ses(aws, sends):
    aws["table"].delete_item(Key={"PK": "USER#u-hit", "SK": "SUB#0007-0003-1600-1900"})

    result = delivery.lambda_handler(event(payload()), None)

    assert result == {"processed": 1, "sent": 0}
    assert sends == []


def test_daily_cap_blocks_before_ses(aws, sends):
    la_today = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    aws["table"].put_item(Item={"PK": "USER#u-hit", "SK": f"NOTIF#{la_today}", "sends": 10})

    result = delivery.lambda_handler(event(payload()), None)

    assert result["sent"] == 0
    assert sends == []


def test_text_updates_resend_only_up_to_bulletin_cap(aws, sends):
    for index in range(1, 5):
        delivery.lambda_handler(event(payload(text_hash=f"hash-{index}")), None)

    assert len(sends) == 3
    claim = aws["table"].get_item(Key={"PK": "USER#u-hit", "SK": "SENT#1001"})["Item"]
    assert int(claim["send_count"]) == 3
    assert claim["last_hash"] == "hash-3"


def test_suppressed_address_is_rechecked_at_delivery_time(aws, sends):
    aws["table"].put_item(Item={"PK": "EMAIL#hit@example.com", "SK": "SUPPRESS"})

    result = delivery.lambda_handler(event(payload()), None)

    assert result["sent"] == 0
    assert sends == []


def test_delivery_keeps_unsubscribe_and_source_headers(aws, sends):
    delivery.lambda_handler(event(payload()), None)

    body = sends[0][1].decode()
    assert "Affected sailings in your window" in body
    assert "16:30 SEA > BBI" in body
    assert "Source: WSF bulletin 1001" in body
    assert "wsdot.wa.gov" in body
    assert "List-Unsubscribe-Post: List-Unsubscribe=One-Click" in body
    assert "References: <bulletin-1001@soundferries.com>" in body


def test_multiple_matching_routes_are_named_in_one_email(aws, sends):
    second = {
        "dep": 7,
        "arr": 4,
        "dep_name": "Seattle",
        "arr_name": "Bremerton",
        "slug": "seattle-bremerton",
    }
    doc = payload(matches=[payload()["subscription"], second])

    delivery.lambda_handler(event(doc), None)

    body = sends[0][1].decode()
    assert "Subject: Ferry alert: multiple saved routes" in body
    assert "Seattle > Bainbridge Island" in body
    assert "Seattle > Bremerton" in body
    assert len(sends) == 1


def test_latency_anchors_on_this_observation(aws, sends, capsys):
    now_ms = int(time.time() * 1000)
    delivery.lambda_handler(event(payload(observed_at_ms=now_ms)), None)

    lines = [line for line in capsys.readouterr().out.splitlines() if "AlertSend" in line]
    assert lines
    latency = json.loads(lines[-1])["AlertSend"]["latency_ms"]
    assert 0 <= latency < 60_000


def rendered_text(mime: bytes) -> str:
    """The decoded text/plain body - set_content may quoted-printable-wrap
    long lines, so substring checks must run on the decoded content."""
    from email import message_from_bytes, policy

    return message_from_bytes(mime, policy=policy.default).get_content()


def test_title_prints_once_when_wsf_text_repeats_it(aws, sends):
    # The 2026-09-03 Labor Day email (bulletin 117482): title == text, no
    # body ingested, status bulletin (parsed clean, nothing to parse).
    doc = payload()
    doc["alert"].update(
        title="Service during Labor Day weekend", text="Service during Labor Day weekend"
    )
    doc["sailings"] = []

    delivery.lambda_handler(event(doc), None)

    text = rendered_text(sends[0][1])
    assert text.count("Service during Labor Day weekend") == 1
    assert "couldn't determine" not in text  # nothing to parse, nothing to caveat
    assert text.startswith("Service during Labor Day weekend\n\nYour sailings:")


def test_body_renders_under_the_title(aws, sends):
    doc = payload()
    doc["alert"].update(
        title="Service during Labor Day weekend",
        text="Service during Labor Day weekend",
        body=(
            "Sailings on Monday, Sept. 7 will follow the Sunday schedule.\n\n"
            "Expect heavy traffic at Colman Dock Friday afternoon."
        ),
    )
    doc["sailings"] = []

    delivery.lambda_handler(event(doc), None)

    text = rendered_text(sends[0][1])
    assert text.count("Service during Labor Day weekend") == 1
    assert (
        "Service during Labor Day weekend\n\n"
        "Sailings on Monday, Sept. 7 will follow the Sunday schedule.\n\n"
        "Expect heavy traffic at Colman Dock Friday afternoon.\n\n"
        "Your sailings:"
    ) in text


def test_text_and_body_both_render_when_each_adds_information(aws, sends):
    doc = payload()
    doc["alert"].update(
        title="FVS #2 CATHLAMET out of service start of 7/24",
        text="FVS #2 - Missing crew. The 0405 VASH>FAU is cancelled.",
        body="The #2 Cathlamet will be out of service, due to missing USCG regulated crewing.",
    )

    delivery.lambda_handler(event(doc), None)

    text = rendered_text(sends[0][1])
    assert text.index("FVS #2 CATHLAMET") < text.index("Missing crew") < text.index("USCG")
    assert "Affected sailings in your window:" in text
