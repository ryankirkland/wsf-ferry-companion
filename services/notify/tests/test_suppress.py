import json

from conftest import jwt_event
from wsf_notify import api, suppress


def _sns_event(message: dict) -> dict:
    return {"Records": [{"Sns": {"Message": json.dumps(message)}}]}


def _subscribe(aws):
    api.lambda_handler(
        jwt_event(
            "POST /v1/subscriptions",
            body={"dep": 7, "arr": 3, "window_start": "16:00", "window_end": "19:00"},
        ),
        None,
    )


def test_complaint_suppresses_and_removes_subs(aws):
    _subscribe(aws)
    result = suppress.lambda_handler(
        _sns_event(
            {
                "eventType": "Complaint",
                "complaint": {"complainedRecipients": [{"emailAddress": "RIDER@example.com"}]},
            }
        ),
        None,
    )
    assert result["suppressed"] == 1
    items = aws["table"].scan()["Items"]
    assert not [it for it in items if it["SK"].startswith("SUB#")]
    assert any(it["SK"] == "SUPPRESS" for it in items)


def test_permanent_bounce_suppresses(aws):
    _subscribe(aws)
    result = suppress.lambda_handler(
        _sns_event(
            {
                "eventType": "Bounce",
                "bounce": {
                    "bounceType": "Permanent",
                    "bouncedRecipients": [{"emailAddress": "rider@example.com"}],
                },
            }
        ),
        None,
    )
    assert result["suppressed"] == 1


def test_transient_bounce_and_delivery_do_nothing(aws):
    _subscribe(aws)
    for message in (
        {
            "eventType": "Bounce",
            "bounce": {
                "bounceType": "Transient",
                "bouncedRecipients": [{"emailAddress": "rider@example.com"}],
            },
        },
        {"eventType": "Delivery"},
    ):
        result = suppress.lambda_handler(_sns_event(message), None)
        assert result["suppressed"] == 0
    items = aws["table"].scan()["Items"]
    assert [it for it in items if it["SK"].startswith("SUB#")]  # subs intact
    assert not any(it["SK"] == "SUPPRESS" for it in items)
