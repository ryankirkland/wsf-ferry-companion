"""Subscription API Lambda (M3 D2, ADR-0006).

Routes (HTTP API v2 payload):
- POST   /v1/subscriptions        JWT   create (pair + time window)
- GET    /v1/subscriptions        JWT   list mine
- DELETE /v1/subscriptions/{sid}  JWT   delete one
- POST   /v1/unsubscribe          token RFC 8058 one-click: unsub ALL
- GET    /v1/unsubscribe          -     303 to the static button page
                                        (mail scanners GET links; GET
                                        never mutates)

Identity comes from the Cognito JWT authorizer (sub + email claims).
Subscriptions are two items written transactionally: USER#<sub>/SUB#<sid>
(manage view) and ROUTE#<route_id>/SUB#<sub>#<sid> (fan-out query), plus
an EMAIL#<email>/USER pointer so SES bounce/complaint events - which only
carry an email - can find and remove the user's subscriptions.
"""

import json
import os
import re
import time

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from wsf_core.tokens import TokenError, canonicalize_email, verify

SUB_LIMIT = 10
_INDEX_TTL_S = 300
_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

_index_cache: tuple[float, dict] | None = None
_secrets_cache: dict[str, str] | None = None


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _pairs_index() -> dict:
    global _index_cache
    if _index_cache and time.monotonic() - _index_cache[0] < _INDEX_TTL_S:
        return _index_cache[1]
    body = (
        boto3.client("s3")
        .get_object(Bucket=os.environ["DATA_BUCKET"], Key="data/pairs/index.json")["Body"]
        .read()
    )
    _index_cache = (time.monotonic(), json.loads(body))
    return _index_cache[1]


def _link_secrets() -> dict[str, str]:
    global _secrets_cache
    if _secrets_cache is None:
        value = boto3.client("ssm").get_parameter(
            Name=os.environ["LINK_SECRETS_PARAM"], WithDecryption=True
        )["Parameter"]["Value"]
        _secrets_cache = json.loads(value)
    return _secrets_cache


def _resp(status: int, body: dict | None = None, headers: dict | None = None) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", **(headers or {})},
        "body": json.dumps(body if body is not None else {}),
    }


def _claims(event: dict) -> tuple[str, str]:
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    return claims["sub"], canonicalize_email(claims["email"])


def lambda_handler(event, context):
    route_key = event.get("routeKey", "")
    try:
        if route_key == "POST /v1/subscriptions":
            return _create(event)
        if route_key == "GET /v1/subscriptions":
            return _list(event)
        if route_key == "DELETE /v1/subscriptions/{sid}":
            return _delete(event)
        if route_key == "POST /v1/unsubscribe":
            return _unsubscribe_all(event)
        if route_key == "GET /v1/unsubscribe":
            # Never mutate on GET: land on the static confirmation page,
            # carrying the token in the URL fragment (never logged).
            token = (event.get("queryStringParameters") or {}).get("token", "")
            return {
                "statusCode": 303,
                "headers": {"location": f"{os.environ['SITE_ORIGIN']}/unsubscribe/#{token}"},
                "body": "",
            }
        return _resp(404, {"error": "unknown route"})
    except TokenError:
        return _resp(403, {"error": "invalid or expired link"})


def _sub_id(dep: int, arr: int, start: str, end: str) -> str:
    # Natural key: identical subscription requests are idempotent.
    return f"{dep:04d}-{arr:04d}-{start.replace(':', '')}-{end.replace(':', '')}"


def _validate_body(event: dict) -> tuple[dict, dict | None]:
    try:
        body = json.loads(event.get("body") or "{}")
    except ValueError:
        return {}, _resp(400, {"error": "invalid JSON"})
    dep, arr = body.get("dep"), body.get("arr")
    start, end = body.get("window_start"), body.get("window_end")
    if not (isinstance(dep, int) and isinstance(arr, int)):
        return {}, _resp(400, {"error": "dep and arr must be terminal ids"})
    if not (isinstance(start, str) and _HHMM_RE.match(start)) or not (
        isinstance(end, str) and _HHMM_RE.match(end)
    ):
        return {}, _resp(400, {"error": "window_start/window_end must be HH:MM"})
    if start >= end:
        return {}, _resp(400, {"error": "window must start before it ends (same service day)"})

    pair = next((p for p in _pairs_index()["pairs"] if p["dep"] == dep and p["arr"] == arr), None)
    if pair is None:
        return {}, _resp(400, {"error": "unknown terminal pair"})
    if pair.get("route_id") is None:
        return {}, _resp(
            400,
            {"error": "this crossing has no alert route upstream - alerts cannot target it"},
        )
    return {"pair": pair, "start": start, "end": end}, None


def _create(event: dict) -> dict:
    user_sub, email = _claims(event)
    parsed, err = _validate_body(event)
    if err:
        return err
    pair, start, end = parsed["pair"], parsed["start"], parsed["end"]
    table = _table()

    if table.get_item(Key={"PK": f"EMAIL#{email}", "SK": "SUPPRESS"}).get("Item"):
        return _resp(
            409,
            {
                "error": "this address previously bounced or reported spam; "
                "contact us to restore delivery"
            },
        )

    existing = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("SUB#"),
    )
    if existing["Count"] >= SUB_LIMIT:
        return _resp(409, {"error": f"subscription limit is {SUB_LIMIT}"})

    sid = _sub_id(pair["dep"], pair["arr"], start, end)
    now = int(time.time())
    attrs = {
        "dep": pair["dep"],
        "arr": pair["arr"],
        "dep_name": pair["dep_name"],
        "arr_name": pair["arr_name"],
        "route_id": pair["route_id"],
        "window_start": start,
        "window_end": end,
        "email": email,
        "created_at": now,
    }
    client = boto3.client("dynamodb")
    ser = TypeSerializer()

    def item(pk: str, sk: str, extra: dict) -> dict:
        return {k: ser.serialize(v) for k, v in {"PK": pk, "SK": sk, **extra}.items()}

    client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": os.environ["TABLE_NAME"],
                    "Item": item(f"USER#{user_sub}", f"SUB#{sid}", attrs),
                }
            },
            {
                "Put": {
                    "TableName": os.environ["TABLE_NAME"],
                    "Item": item(f"ROUTE#{pair['route_id']}", f"SUB#{user_sub}#{sid}", attrs),
                }
            },
            {
                "Put": {
                    "TableName": os.environ["TABLE_NAME"],
                    "Item": item(f"EMAIL#{email}", "USER", {"user_sub": user_sub}),
                }
            },
        ]
    )
    return _resp(201, {"id": sid, **{k: attrs[k] for k in attrs if k != "email"}})


def _list(event: dict) -> dict:
    user_sub, _ = _claims(event)
    resp = _table().query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("SUB#"),
    )
    subs = [
        {
            "id": it["SK"].removeprefix("SUB#"),
            **{
                k: (int(it[k]) if k in ("dep", "arr", "route_id", "created_at") else it[k])
                for k in (
                    "dep",
                    "arr",
                    "dep_name",
                    "arr_name",
                    "route_id",
                    "window_start",
                    "window_end",
                    "created_at",
                )
            },
        }
        for it in resp["Items"]
    ]
    return _resp(200, {"subscriptions": subs})


def _delete_pair(table_name: str, client, user_sub: str, sid: str, route_id: int) -> None:
    ser = TypeSerializer()
    client.transact_write_items(
        TransactItems=[
            {
                "Delete": {
                    "TableName": table_name,
                    "Key": {
                        "PK": ser.serialize(f"USER#{user_sub}"),
                        "SK": ser.serialize(f"SUB#{sid}"),
                    },
                }
            },
            {
                "Delete": {
                    "TableName": table_name,
                    "Key": {
                        "PK": ser.serialize(f"ROUTE#{route_id}"),
                        "SK": ser.serialize(f"SUB#{user_sub}#{sid}"),
                    },
                }
            },
        ]
    )


def _delete(event: dict) -> dict:
    user_sub, _ = _claims(event)
    sid = event["pathParameters"]["sid"]
    got = _table().get_item(Key={"PK": f"USER#{user_sub}", "SK": f"SUB#{sid}"}).get("Item")
    if not got:
        return _resp(404, {"error": "no such subscription"})
    _delete_pair(
        os.environ["TABLE_NAME"], boto3.client("dynamodb"), user_sub, sid, int(got["route_id"])
    )
    return _resp(200, {"deleted": sid})


def remove_all_subscriptions(user_sub: str) -> int:
    """Shared with the suppression handler: delete every subscription pair."""
    table = _table()
    client = boto3.client("dynamodb")
    resp = table.query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}") & Key("SK").begins_with("SUB#"),
    )
    for it in resp["Items"]:
        _delete_pair(
            os.environ["TABLE_NAME"],
            client,
            user_sub,
            it["SK"].removeprefix("SUB#"),
            int(it["route_id"]),
        )
    return resp["Count"]


def _unsubscribe_all(event: dict) -> dict:
    # Token arrives in the query string (RFC 8058 POSTs to the URL as-is)
    # or as a form/JSON field from the button page.
    token = (event.get("queryStringParameters") or {}).get("token", "")
    if not token:
        body = event.get("body") or ""
        m = re.search(r"token=([A-Za-z0-9_\-\.=]+)", body)
        token = m.group(1) if m else ""
    claims = verify(
        token, purpose="unsub", secrets=_link_secrets(), max_age_s=None
    )  # non-expiring: unsubscribe must always work
    removed = remove_all_subscriptions(claims["u"])
    return _resp(200, {"unsubscribed": True, "removed": removed})
