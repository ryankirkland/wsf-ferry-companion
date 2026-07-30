import json

from conftest import LINK_SECRETS, jwt_event
from wsf_core.tokens import sign
from wsf_notify import api

GOOD = {"dep": 7, "arr": 3, "window_start": "16:00", "window_end": "19:00"}


def _post(body, **kw):
    return api.lambda_handler(jwt_event("POST /v1/subscriptions", body=body, **kw), None)


def test_create_list_delete_roundtrip(aws):
    created = _post(GOOD)
    assert created["statusCode"] == 201
    sid = json.loads(created["body"])["id"]

    listed = json.loads(api.lambda_handler(jwt_event("GET /v1/subscriptions"), None)["body"])
    assert len(listed["subscriptions"]) == 1
    sub = listed["subscriptions"][0]
    assert sub["id"] == sid and sub["route_id"] == 5 and sub["window_start"] == "16:00"
    assert "email" not in sub  # never echo the address back in lists

    # Both item sides + the email pointer exist.
    items = aws["table"].scan()["Items"]
    pks = {it["PK"] for it in items}
    assert {"USER#user-1", "ROUTE#5", "EMAIL#rider@example.com"} <= pks

    deleted = api.lambda_handler(
        jwt_event("DELETE /v1/subscriptions/{sid}", path={"sid": sid}), None
    )
    assert deleted["statusCode"] == 200
    remaining = [it for it in aws["table"].scan()["Items"] if it["SK"].startswith("SUB#")]
    assert remaining == []  # both sides gone


def test_create_is_idempotent(aws):
    assert _post(GOOD)["statusCode"] == 201
    assert _post(GOOD)["statusCode"] == 201  # same natural key overwrites
    subs = json.loads(api.lambda_handler(jwt_event("GET /v1/subscriptions"), None)["body"])
    assert len(subs["subscriptions"]) == 1


def test_validation_rejects_bad_input(aws):
    cases = [
        ({**GOOD, "dep": "seattle"}, "terminal ids"),
        ({**GOOD, "window_start": "26:00"}, "HH:MM"),
        ({**GOOD, "window_start": "19:00", "window_end": "16:00"}, "start before"),
        ({**GOOD, "dep": 99, "arr": 98}, "unknown terminal pair"),
        ({**GOOD, "dep": 1, "arr": 10}, "no alert route"),
    ]
    for body, fragment in cases:
        resp = _post(body)
        assert resp["statusCode"] == 400, body
        assert fragment in json.loads(resp["body"])["error"]


def test_subscription_limit(aws):
    for hour in range(4, 14):
        body = {**GOOD, "window_start": f"{hour:02d}:00", "window_end": f"{hour:02d}:30"}
        assert _post(body)["statusCode"] == 201
    over = _post({**GOOD, "window_start": "22:00", "window_end": "23:00"})
    assert over["statusCode"] == 409


def test_suppressed_address_cannot_subscribe(aws):
    aws["table"].put_item(
        Item={"PK": "EMAIL#rider@example.com", "SK": "SUPPRESS", "reason": "complaint"}
    )
    resp = _post(GOOD)
    assert resp["statusCode"] == 409
    assert "bounced or reported spam" in json.loads(resp["body"])["error"]


def test_one_click_unsubscribe_removes_everything(aws):
    _post(GOOD)
    _post({**GOOD, "dep": 3, "arr": 7})
    token = sign({"u": "user-1"}, purpose="unsub", secret=LINK_SECRETS["k1"], kid="k1")

    # RFC 8058: provider POSTs to the URL with the token in the query string.
    resp = api.lambda_handler(
        {
            "routeKey": "POST /v1/unsubscribe",
            "queryStringParameters": {"token": token},
            "body": "List-Unsubscribe=One-Click",
            "requestContext": {},
        },
        None,
    )
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["removed"] == 2
    remaining = [it for it in aws["table"].scan()["Items"] if it["SK"].startswith("SUB#")]
    assert remaining == []


def test_unsubscribe_rejects_wrong_purpose_token(aws):
    token = sign({"u": "user-1"}, purpose="manage", secret=LINK_SECRETS["k1"], kid="k1")
    resp = api.lambda_handler(
        {
            "routeKey": "POST /v1/unsubscribe",
            "queryStringParameters": {"token": token},
            "requestContext": {},
        },
        None,
    )
    assert resp["statusCode"] == 403


def test_get_unsubscribe_never_mutates(aws):
    _post(GOOD)
    token = sign({"u": "user-1"}, purpose="unsub", secret=LINK_SECRETS["k1"], kid="k1")
    resp = api.lambda_handler(
        {
            "routeKey": "GET /v1/unsubscribe",
            "queryStringParameters": {"token": token},
            "requestContext": {},
        },
        None,
    )
    assert resp["statusCode"] == 303
    assert resp["headers"]["location"].startswith("https://ferrysound.com/unsubscribe/#")
    subs = [it for it in aws["table"].scan()["Items"] if it["SK"].startswith("SUB#")]
    assert len(subs) == 2  # untouched: scanners GET links all the time
