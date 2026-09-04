"""SQS-driven SES delivery for matched ferry-alert notifications.

The notifier enqueues one message per user and bulletin text version. This
worker deliberately records SENT state only after SES accepts the message:
retries may rarely duplicate an email if the process dies in that narrow gap,
but a transient SES failure can never consume the user's delivery claim.
"""

import json
import os
import time
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from wsf_core.alert_text import alert_details
from wsf_core.tokens import sign

from wsf_notify.metrics import emit, emit_latency

SOUND_TZ = ZoneInfo("America/Los_Angeles")
MAX_SENDS_PER_BULLETIN = 3
# At most one of a bulletin's three sends may be a body re-notification, so
# two slots always remain for what the title and one-liner say. ADR-0006's
# priority is that missing a real cancellation is the worse failure, and
# body edits are the frequent kind (that is why BodyOnlyEdits exists): an
# unbounded share would let a chatty weekend notice mute the Monday
# cancellation announcement. Caught in review, 2026-09-04.
MAX_BODY_RESENDS = 1
DAILY_CAP = 10
DELIVERY_TTL_S = 90 * 86400

_secrets_cache: dict[str, str] | None = None


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _link_secrets() -> dict[str, str]:
    global _secrets_cache
    if _secrets_cache is None:
        _secrets_cache = json.loads(
            boto3.client("ssm").get_parameter(
                Name=os.environ["LINK_SECRETS_PARAM"], WithDecryption=True
            )["Parameter"]["Value"]
        )
    return _secrets_cache


def lambda_handler(event, context):
    records = event.get("Records") or []
    sent = 0
    for record in records:
        payload = json.loads(record["body"])
        if _deliver(payload):
            sent += 1
    return {"processed": len(records), "sent": sent}


def _deliver(payload: dict) -> bool:
    if payload.get("v") != 1:
        raise ValueError("unsupported delivery payload")

    user_sub = str(payload["user_sub"])
    email = str(payload["email"])
    alert = payload["alert"]
    # The dedup key covers the body too, so a labelled body re-notification
    # is not mistaken for a duplicate. A message enqueued before send_hash
    # existed (in flight across the deploy) falls back to the old key, which
    # is exactly what its SENT# item holds.
    send_key = str(payload.get("send_hash") or payload["text_hash"])
    is_body_resend = payload.get("update_reason") == "body"
    table = _table()

    if table.get_item(Key={"PK": f"EMAIL#{email}", "SK": "SUPPRESS"}).get("Item"):
        emit(DeliverySuppressed=1)
        return False

    if not _has_active_subscription(table, user_sub, payload.get("subscription_ids") or []):
        emit(DeliveryUnsubscribed=1)
        return False

    la_date = datetime.now(SOUND_TZ).date().isoformat()
    reason, previously_sent = _eligibility(
        table,
        user_sub,
        str(alert["id"]),
        send_key,
        str(payload["text_hash"]),
        la_date,
        is_body_resend,
    )
    if reason:
        emit(**{reason: 1})
        return False

    mime = _build_message(payload, previously_sent=previously_sent)
    _ses_send(email, mime)

    recorded = _record_sent(
        table, user_sub, str(alert["id"]), send_key, la_date, is_body_resend=is_body_resend
    )
    latency_ms = int(time.time() * 1000) - int(payload["observed_at_ms"])
    print(
        json.dumps(
            {
                "AlertSend": {
                    "bulletin_id": alert["id"],
                    "user": user_sub,
                    "latency_ms": latency_ms,
                    "parsed": bool(payload.get("parsed_clean") and payload.get("sailings")),
                    "recorded": recorded,
                }
            }
        )
    )
    emit(EmailsSent=1, **({} if recorded else {"DeliveryRecordConflicts": 1}))
    emit_latency(latency_ms)
    return True


def _has_active_subscription(table, user_sub: str, subscription_ids: list[str]) -> bool:
    return any(
        table.get_item(Key={"PK": f"USER#{user_sub}", "SK": f"SUB#{subscription_id}"}).get("Item")
        for subscription_id in subscription_ids
    )


def _eligibility(
    table,
    user_sub: str,
    bulletin_id: str,
    send_key: str,
    text_key: str,
    la_date: str,
    is_body_resend: bool,
) -> tuple[str | None, bool]:
    """(reason to skip, has this rider been emailed about this bulletin before).

    The second value decides whether the email may say "since we emailed
    you": a body edit re-runs the cancellation parser, so it can match a
    rider the first poll never matched, and that rider's FIRST email must
    not claim a previous one (caught in review, 2026-09-04).
    """
    prior = table.get_item(Key={"PK": f"USER#{user_sub}", "SK": f"SENT#{bulletin_id}"}).get(
        "Item", {}
    )
    previously_sent = "last_hash" in prior
    # Both keys block a duplicate. A SENT# item written before send_hash
    # existed holds the raw text key for its 90-day life, and comparing only
    # the new key would silently retire the duplicate guard for that whole
    # window - any re-enqueue (WSF bumping PublishDate with unchanged prose,
    # a BULLETIN# lost to TTL) would re-email everyone. The cost is one
    # missed body update on bulletins last sent before this deploy.
    if prior.get("last_hash") in {send_key, text_key}:
        return "DeliveryDuplicates", previously_sent
    if int(prior.get("send_count", 0)) >= MAX_SENDS_PER_BULLETIN:
        return "BulletinCapped", previously_sent
    if is_body_resend and int(prior.get("body_sends", 0)) >= MAX_BODY_RESENDS:
        return "BodyResendCapped", previously_sent

    daily = table.get_item(Key={"PK": f"USER#{user_sub}", "SK": f"NOTIF#{la_date}"}).get("Item", {})
    if int(daily.get("sends", 0)) >= DAILY_CAP:
        return "DailyCapped", previously_sent
    return None, previously_sent


def _record_sent(
    table,
    user_sub: str,
    bulletin_id: str,
    send_key: str,
    la_date: str,
    is_body_resend: bool = False,
) -> bool:
    ser = TypeSerializer()

    def values(raw: dict) -> dict:
        return {key: ser.serialize(value) for key, value in raw.items()}

    try:
        boto3.client("dynamodb").transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": os.environ["TABLE_NAME"],
                        "Key": values({"PK": f"USER#{user_sub}", "SK": f"SENT#{bulletin_id}"}),
                        "UpdateExpression": (
                            "SET last_hash = :h, "
                            "send_count = if_not_exists(send_count, :z) + :one, "
                            "body_sends = if_not_exists(body_sends, :z) + :body, "
                            "expires_at = :ttl"
                        ),
                        "ConditionExpression": (
                            "attribute_not_exists(last_hash) OR "
                            "(last_hash <> :h AND "
                            "(attribute_not_exists(send_count) OR send_count < :cap))"
                        ),
                        "ExpressionAttributeValues": values(
                            {
                                ":h": send_key,
                                ":z": 0,
                                ":one": 1,
                                ":body": 1 if is_body_resend else 0,
                                ":cap": MAX_SENDS_PER_BULLETIN,
                                ":ttl": int(time.time()) + DELIVERY_TTL_S,
                            }
                        ),
                    }
                },
                {
                    "Update": {
                        "TableName": os.environ["TABLE_NAME"],
                        "Key": values({"PK": f"USER#{user_sub}", "SK": f"NOTIF#{la_date}"}),
                        "UpdateExpression": (
                            "SET sends = if_not_exists(sends, :z) + :one, expires_at = :ttl"
                        ),
                        "ConditionExpression": ("attribute_not_exists(sends) OR sends < :cap"),
                        "ExpressionAttributeValues": values(
                            {
                                ":z": 0,
                                ":one": 1,
                                ":cap": DAILY_CAP,
                                ":ttl": int(time.time()) + 3 * 86400,
                            }
                        ),
                    }
                },
            ]
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        # Re-read: a concurrent send may have claimed this version, capped
        # the bulletin, or filled the day. Only a reason we recognize turns
        # the cancelled transaction into a skip; anything else is a real
        # error and must reach the retry. `send_key` covers the pre-deploy
        # text key too, so a legacy SENT# item still reads as a duplicate.
        reason, _ = _eligibility(
            table, user_sub, bulletin_id, send_key, send_key, la_date, is_body_resend
        )
        if reason is None:
            raise
        print(
            json.dumps(
                {
                    "DeliveryRecordConflict": {
                        "bulletin_id": bulletin_id,
                        "user": user_sub,
                        "reason": reason,
                    }
                }
            )
        )
        return False
    return True


def _build_message(payload: dict, previously_sent: bool = False) -> bytes:
    alert = payload["alert"]
    sub = payload["subscription"]
    sailings = payload.get("sailings") or []
    matches = payload.get("matches") or []
    site = os.environ["SITE_ORIGIN"]
    secrets = _link_secrets()
    kid, secret = next(iter(secrets.items()))
    token = sign(
        {"u": payload["user_sub"]},
        purpose="unsub",
        secret=secret,
        kid=kid,
    )
    unsub_url = f"{os.environ['API_ORIGIN']}/v1/unsubscribe?token={token}"
    trip_url = f"{site}/trip/{sub.get('slug', '')}"

    # Title once, then only the texts that add to it - WSF's one-liner is
    # usually the title retyped, and the substance lives in the body.
    lines = [alert["title"]]
    if payload.get("update_reason") == "body" and previously_sent:
        # A second email about a bulletin the rider already heard about. Say
        # why up front, before the detail it is pointing at (owner's call,
        # 2026-09-03) - an unexplained repeat reads as a bug.
        lines += ["", "WSF has added new information to this notice since we emailed you."]
    for detail in alert_details(alert["title"], alert.get("text"), alert.get("body")):
        lines += ["", detail]
    if sailings:
        lines += ["", "Affected sailings in your window:"]
        lines += [f"  - {s['hhmm']} {s['dep_code']} > {s['arr_code']}" for s in sailings]
    elif not payload.get("parsed_clean"):
        lines += [
            "",
            "We couldn't determine the specific sailings from WSF's notice - "
            "check your route before you leave.",
        ]
    if len(matches) > 1:
        lines += ["", "Matched saved crossings:"]
        lines += [f"  - {match['dep_name']} > {match['arr_name']}" for match in matches]
    lines += [
        "",
        f"Your sailings: {trip_url}",
        "WSF service alerts: https://wsdot.wa.gov/travel/washington-state-ferries/service-alerts",
        f"Source: WSF bulletin {alert['id']}",
        "",
        f"Unsubscribe from all Sound Ferries alerts: {unsub_url}",
        f"Manage subscriptions: {site}/alerts",
    ]

    msg = EmailMessage()
    msg["From"] = os.environ["FROM_ADDRESS"]
    msg["To"] = payload["email"]
    if len(matches) > 1:
        msg["Subject"] = "Ferry alert: multiple saved routes"
    else:
        msg["Subject"] = f"Ferry alert: {sub['dep_name']} → {sub['arr_name']}"
    msg["References"] = f"<bulletin-{alert['id']}@soundferries.com>"
    msg["List-Unsubscribe"] = f"<{unsub_url}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content("\n".join(lines))
    return msg.as_bytes()


def _ses_send(to_address: str, mime_bytes: bytes) -> None:
    boto3.client("sesv2").send_email(
        FromEmailAddress=os.environ["FROM_ADDRESS"],
        Destination={"ToAddresses": [to_address]},
        Content={"Raw": {"Data": mime_bytes}},
        ConfigurationSetName=os.environ["SES_CONFIGURATION_SET"],
    )
