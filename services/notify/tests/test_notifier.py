import json

import pytest
from conftest import jwt_event
from wsf_notify import api, notifier

PUBLISHED = "2026-01-15T22:05:00+00:00"  # 2:05 PM PST
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
