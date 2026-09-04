import json
import time
from datetime import datetime
from email import message_from_bytes, policy

import pytest
from conftest import jwt_event
from wsf_core.alerts import body_hash, send_hash, text_hash
from wsf_notify import api, delivery, notifier

PUBLISHED = "2026-01-15T22:05:00+00:00"  # 2:05 PM PST
CANCEL_TEXT = "The 1630 SEA/BBI sailing is cancelled due to crewing."


def alert(
    id=1001, text=CANCEL_TEXT, published=PUBLISHED, route_ids=(5,), all_routes=False, body=None
):
    return {
        "id": id,
        "title": "Sea/BI - Service update",
        "text": text,
        "body": body,
        "published": published,
        "route_ids": list(route_ids),
        "all_routes": all_routes,
    }


def subscribe(sub, email, dep, arr, start, end):
    response = api.lambda_handler(
        jwt_event(
            "POST /v1/subscriptions",
            sub=sub,
            email=email,
            body={"dep": dep, "arr": arr, "window_start": start, "window_end": end},
        ),
        None,
    )
    assert response["statusCode"] == 201


def run(alerts, observed_ms=1_800_000_000_000):
    return notifier.lambda_handler({"observed_at_ms": observed_ms, "alerts": alerts}, None)


def queued_payloads(aws) -> list[dict]:
    response = aws["sqs"].receive_message(
        QueueUrl=aws["queue_url"], MaxNumberOfMessages=10, WaitTimeSeconds=0
    )
    return [json.loads(message["Body"]) for message in response.get("Messages", [])]


def test_window_matching_queues_only_the_matching_user(aws):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    subscribe("u-early", "early@example.com", 7, 3, "04:00", "06:00")
    subscribe("u-reverse", "rev@example.com", 3, 7, "16:00", "19:00")

    result = run([alert()])
    payloads = queued_payloads(aws)

    assert result["queued"] == 1
    assert [payload["email"] for payload in payloads] == ["hit@example.com"]
    assert payloads[0]["sailings"] == [
        {
            "hhmm": "16:30",
            "dep_code": "SEA",
            "arr_code": "BBI",
            "dep_id": 7,
            "arr_id": 3,
        }
    ]


def test_queued_subscription_id_remains_deliverable(aws, monkeypatch):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert()])
    queued = queued_payloads(aws)[0]
    sends = []
    monkeypatch.setattr(delivery, "_ses_send", lambda to, mime: sends.append(to))

    result = delivery.lambda_handler(
        {"Records": [{"messageId": "message-1", "body": json.dumps(queued)}]}, None
    )

    assert result == {"processed": 1, "sent": 1}
    assert sends == ["hit@example.com"]


def test_later_subscription_window_is_not_discarded_for_same_user(aws):
    subscribe("u-both", "both@example.com", 7, 3, "04:00", "06:00")
    subscribe("u-both", "both@example.com", 7, 3, "16:00", "19:00")

    result = run([alert()])
    payloads = queued_payloads(aws)

    assert result["queued"] == 1
    assert len(payloads) == 1
    assert payloads[0]["user_sub"] == "u-both"
    assert payloads[0]["subscription"]["dep"] == 7
    assert payloads[0]["sailings"][0]["hhmm"] == "16:30"


def test_two_matching_subscriptions_still_queue_one_delivery(aws):
    subscribe("u-both", "both@example.com", 7, 3, "15:00", "17:00")
    subscribe("u-both", "both@example.com", 7, 3, "16:00", "19:00")

    result = run([alert()])
    payloads = queued_payloads(aws)

    assert result["queued"] == 1
    assert len(payloads) == 1
    assert len(payloads[0]["sailings"]) == 1


def test_each_matching_user_gets_an_independent_queue_message(aws):
    subscribe("u-one", "one@example.com", 7, 3, "16:00", "19:00")
    subscribe("u-two", "two@example.com", 7, 3, "16:00", "19:00")

    result = run([alert()])
    payloads = queued_payloads(aws)

    assert result["queued"] == 2
    assert {payload["user_sub"] for payload in payloads} == {"u-one", "u-two"}


def test_duplicate_invoke_queues_nothing_new(aws):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert()])
    assert len(queued_payloads(aws)) == 1

    result = run([alert()])
    assert result["queued"] == 0
    assert queued_payloads(aws) == []


def test_parse_miss_falls_back_to_publish_window(aws):
    vague = "Sailings may be cancelled throughout the day due to crewing."
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    subscribe("u-miss", "miss@example.com", 7, 3, "04:00", "06:00")

    result = run([alert(text=vague)])
    payloads = queued_payloads(aws)

    assert result["queued"] == 1
    assert payloads[0]["email"] == "hit@example.com"
    assert payloads[0]["parsed_clean"] is False
    assert payloads[0]["sailings"] == []


def test_empty_feed_guard_and_gone_marking(aws):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    run([alert()])
    queued_payloads(aws)

    guarded = run([])
    assert guarded.get("guarded") is True
    item = aws["table"].get_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})["Item"]
    assert "gone_at" not in item

    run([alert(id=2002, text="Terminal status update, no cancellations.")])
    item = aws["table"].get_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})["Item"]
    assert "gone_at" in item


def test_all_routes_alert_reaches_every_route_sub(aws):
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    result = run([alert(route_ids=(), all_routes=True, text="Systemwide notice.")])

    assert result["queued"] == 1
    assert queued_payloads(aws)[0]["email"] == "hit@example.com"


def test_bulletin_state_is_not_committed_when_queueing_fails(aws, monkeypatch):
    subscribe("u-hit", "hit@example.com", 7, 3, "16:00", "19:00")
    monkeypatch.setattr(
        notifier,
        "_enqueue_delivery",
        lambda payload: (_ for _ in ()).throw(RuntimeError("queue unavailable")),
    )

    with pytest.raises(RuntimeError, match="queue unavailable"):
        run([alert()])

    response = aws["table"].get_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})
    assert "Item" not in response


def test_route_queries_paginate_before_grouping_users():
    item1 = {"SK": "SUB#u-one#first"}
    item2 = {"SK": "SUB#u-two#second"}

    class PagedTable:
        def __init__(self):
            self.calls = 0

        def query(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return {"Items": [item1], "LastEvaluatedKey": {"PK": "ROUTE#5", "SK": item1["SK"]}}
            assert kwargs["ExclusiveStartKey"]["SK"] == item1["SK"]
            return {"Items": [item2]}

    table = PagedTable()
    grouped = notifier._subscriptions_by_user(table, alert())

    assert table.calls == 2
    assert set(grouped) == {"u-one", "u-two"}


def bulletin_item(aws, bid=1001) -> dict:
    return aws["table"].get_item(Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"})["Item"]


def test_deploying_body_support_does_not_requeue_live_bulletins(aws, capsys):
    # State as the pre-2026-09-03 notifier left it: title+text hash, no
    # body_hash. The same bulletin now arrives WITH a body. The notification
    # key ignores the body, so nothing is queued and nobody is re-emailed;
    # the body version is adopted silently (no BodyOnlyEdit - it is not one).
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    aws["table"].put_item(
        Item={
            "PK": "ALERTS",
            "SK": "BULLETIN#1001",
            "published_ms": int(datetime.fromisoformat(PUBLISHED).timestamp() * 1000),
            "text_hash": text_hash(status["title"], status["text"]),
            "route_ids": [5],
            "all_routes": False,
        }
    )

    result = run([status])

    # Adopting a first body is not an edit: WSF published nothing new, we
    # simply started reading a field we used to drop. Nobody is emailed.
    assert result == {"queued": 0, "changed_bulletins": 0}
    assert queued_payloads(aws) == []
    assert bulletin_item(aws)["body_hash"] == body_hash(status["body"])
    assert "BodyOnlyEdit" not in capsys.readouterr().out


def test_body_only_edit_requeues_and_says_why(aws, capsys):
    # Owner's call, 2026-09-03: WSF telling us something new about a bulletin
    # the rider already heard about is worth a second email, as long as the
    # email says that is why it arrived.
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    assert run([status])["queued"] == 1
    first = queued_payloads(aws)[0]
    assert first["alert"]["body"] == "Holiday schedule in effect."
    assert first["update_reason"] is None
    capsys.readouterr()

    edited = dict(status, body="Holiday schedule in effect. Expect heavy traffic.")
    result = run([edited])

    assert result["queued"] == 1
    requeued = queued_payloads(aws)[0]
    assert requeued["update_reason"] == "body"
    assert requeued["alert"]["body"] == edited["body"]
    # The notification key never moved; only the send key did.
    assert requeued["text_hash"] == first["text_hash"]
    assert requeued["send_hash"] != first["send_hash"]
    assert bulletin_item(aws)["body_hash"] == body_hash(edited["body"])
    out = capsys.readouterr().out
    assert '"BodyOnlyEdit": {"bulletin_id": "1001"}' in out
    assert '"BodyOnlyEdits": 1' in out

    # Same body again: nothing moves, nothing is queued, nothing is counted.
    assert run([edited])["queued"] == 0
    assert queued_payloads(aws) == []
    assert "BodyOnlyEdit" not in capsys.readouterr().out


def test_whitespace_only_body_churn_never_requeues(aws):
    # body_hash normalizes whitespace, so WSF re-saving the same prose with
    # different Word-paste spacing is not "new information".
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    assert run([status])["queued"] == 1
    queued_payloads(aws)  # drain the first send
    respaced = dict(status, body="Holiday   schedule\n in effect.")
    assert run([respaced])["queued"] == 0
    assert queued_payloads(aws) == []


def test_text_edit_still_requeues_with_the_current_body(aws):
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    run([alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")])
    queued_payloads(aws)

    edited = alert(text="Sea/BI - Service update. View the Real-Time Map.", body="Now with detail.")
    assert run([edited])["queued"] == 1
    assert queued_payloads(aws)[0]["alert"]["body"] == "Now with detail."


def test_cancellation_only_in_the_body_fails_closed_with_the_caveat(aws, monkeypatch):
    # The one-liner repeats the title; the cancellation is prose in the body
    # the codes regex cannot read. Before 2026-09-03 this parsed "clean" with
    # zero sailings and the email carried no caveat at all.
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    body = "Due to crewing, the 5:30 p.m. Seattle to Bainbridge sailing is cancelled."
    result = run([alert(text="Sea/BI - Service update", body=body)])
    queued = queued_payloads(aws)

    assert result["queued"] == 1
    assert queued[0]["parsed_clean"] is False and queued[0]["sailings"] == []

    sends = []
    monkeypatch.setattr(delivery, "_ses_send", lambda to, mime: sends.append(mime))
    delivery.lambda_handler({"Records": [{"messageId": "m", "body": json.dumps(queued[0])}]}, None)

    text = message_from_bytes(sends[0], policy=policy.default).get_content()
    assert body in text
    assert "We couldn't determine the specific sailings" in text


def test_a_long_lived_unchanged_bulletin_gets_its_ttl_pushed_out(aws):
    # Review finding L2, 2026-09-03: a notice that outlives its 90-day TTL
    # was deleted, came back as NEW, and re-emailed everyone. An unchanged
    # bulletin within 30 days of expiry gets a fresh TTL - and nothing else.
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    assert run([status])["queued"] == 1
    fresh_ttl = bulletin_item(aws)["expires_at"]

    # Far from expiry: an unchanged poll writes nothing.
    assert run([status])["queued"] == 0
    assert bulletin_item(aws)["expires_at"] == fresh_ttl

    # Age it to 10 days before expiry: the next unchanged poll refreshes it.
    aws["table"].update_item(
        Key={"PK": "ALERTS", "SK": "BULLETIN#1001"},
        UpdateExpression="SET expires_at = :t",
        ExpressionAttributeValues={":t": int(time.time()) + 10 * 86400},
    )
    assert run([status])["queued"] == 0
    assert bulletin_item(aws)["expires_at"] >= fresh_ttl


def test_body_hash_write_tolerates_a_bulletin_that_vanished(aws, monkeypatch):
    # Review finding L1: the conditional write can only fail if the item was
    # TTL-deleted between the query and the update. That must not raise
    # (a Lambda error + retry for a non-event); the bulletin reappears as
    # NEW on the next poll, which is the right outcome.
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    run([status])
    aws["table"].delete_item(Key={"PK": "ALERTS", "SK": "BULLETIN#1001"})
    notifier._record_body_hash(aws["table"], "1001", "deadbeefdeadbeef")  # no raise
    notifier._refresh_ttl(aws["table"], "1001")  # no raise


def test_a_body_that_vanishes_never_announces_new_information(aws):
    # html_to_text returns None for a markup-only body. Losing a body is not
    # "new information", and announcing it would send an email whose only
    # content is the claim that there is content.
    subscribe("u-hit", "hit@example.com", 7, 3, "13:00", "19:00")
    status = alert(text="Sea/BI - Service update", body="Holiday schedule in effect.")
    assert run([status])["queued"] == 1
    queued_payloads(aws)

    assert run([dict(status, body=None)])["queued"] == 0
    assert queued_payloads(aws) == []
    assert bulletin_item(aws)["body_hash"] == body_hash(None)

    # And when it comes back, the send key returns to one already delivered,
    # so the rider is not emailed a third time about the same prose.
    assert run([status])["queued"] == 1
    restored = queued_payloads(aws)[0]
    assert restored["send_hash"] == send_hash(
        text_hash(status["title"], status["text"]), body_hash(status["body"])
    )
