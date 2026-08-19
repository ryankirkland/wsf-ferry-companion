"""Fan-out notifier Lambda (M3 D3, ADR-0006). Owns ALL per-bulletin state.

Invoked by the alerts poller with the full slimmed feed on every digest
change. Diffs against ALERTS/BULLETIN# items (conditional writes -
duplicate/late invokes are absorbed), classifies NEW/UPDATED/GONE, and
for NEW/UPDATED fans out to matching subscriptions:

- parsed sailings (wsf_core.alert_parse) -> match dep terminal + time
  against each subscription's window
- parse miss -> route-level fallback: notify when the alert's publish
  time (Sound local) lands in [window_start - 2h, window_end], honestly
  marked "we couldn't determine specific sailings"

Per-recipient claims (USER#/SENT#bulletin, conditional) make delivery
effectively-once per (user, bulletin, text-version); max 3 sends per
bulletin per user, 10/day per user counted in America/Los_Angeles, both
claimed atomically. GONE marks (never deletes) bulletin state so an
empty-feed flap cannot re-notify anyone. Per-recipient SES errors are
logged and skipped - one bad address never aborts a fan-out.
"""

import json
import os
import time
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from wsf_core.alert_parse import parse_cancelled_sailings
from wsf_core.tokens import sign

from wsf_notify.metrics import emit, emit_latency

SOUND_TZ = ZoneInfo("America/Los_Angeles")
MAX_SENDS_PER_BULLETIN = 3
DAILY_CAP = 10
FALLBACK_LEAD_H = 2
BULLETIN_TTL_S = 90 * 86400

_secrets_cache: dict[str, str] | None = None
_index_cache: dict | None = None


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


def _all_route_ids() -> list[int]:
    global _index_cache
    if _index_cache is None:
        _index_cache = json.loads(
            boto3.client("s3")
            .get_object(Bucket=os.environ["DATA_BUCKET"], Key="data/pairs/index.json")["Body"]
            .read()
        )
    return sorted({p["route_id"] for p in _index_cache["pairs"] if p.get("route_id") is not None})


def _text_hash(title: str, text: str | None) -> str:
    import hashlib
    import re as _re

    ws = _re.compile(r"\s+")
    return hashlib.sha256(
        f"{ws.sub(' ', title).strip()}\n{ws.sub(' ', text or '').strip()}".encode()
    ).hexdigest()[:16]


def lambda_handler(event, context):
    observed_at_ms = int(event.get("observed_at_ms") or time.time() * 1000)
    feed = event.get("alerts") or []
    table = _table()

    stored = {
        it["SK"].removeprefix("BULLETIN#"): it
        for it in table.query(
            KeyConditionExpression=Key("PK").eq("ALERTS") & Key("SK").begins_with("BULLETIN#")
        )["Items"]
    }

    # Empty-feed sanity guard: a blip must not mark everything GONE (and a
    # later flap-back must not look NEW - though claims would absorb it).
    if not feed and stored:
        print(json.dumps({"EmptyFeedGuard": {"stored": len(stored)}}))
        return {"sent": 0, "guarded": True}

    counts = {"EmailsSent": 0, "SendFailures": 0, "ParseMisses": 0, "BulletinFlapping": 0}
    fresh_ids = set()
    to_notify = []

    for alert in feed:
        bid = str(alert["id"])
        fresh_ids.add(bid)
        published_ms = int(datetime.fromisoformat(alert["published"]).timestamp() * 1000)
        text_hash = _text_hash(alert["title"], alert.get("text"))
        prior = stored.get(bid)
        if (
            prior
            and prior.get("text_hash") == text_hash
            and int(prior["published_ms"]) >= published_ms
        ):
            continue  # unchanged

        # Conditional upsert with a regression guard: a stale invoke (older
        # snapshot) must not clobber newer state or trigger re-sends.
        try:
            table.update_item(
                Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"},
                UpdateExpression=(
                    "SET published_ms = :p, text_hash = :h, route_ids = :r, "
                    "all_routes = :a, first_seen_ms = if_not_exists(first_seen_ms, :seen), "
                    "expires_at = :ttl REMOVE gone_at"
                ),
                ConditionExpression=(
                    "attribute_not_exists(published_ms) OR published_ms < :p "
                    "OR (published_ms = :p AND text_hash <> :h)"
                ),
                ExpressionAttributeValues={
                    ":p": published_ms,
                    ":h": text_hash,
                    ":r": alert.get("route_ids") or [],
                    ":a": bool(alert.get("all_routes")),
                    ":seen": observed_at_ms,
                    ":ttl": int(time.time()) + BULLETIN_TTL_S,
                },
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            continue  # a fresher invoke got here first
        to_notify.append((alert, text_hash))

    for bid, prior in stored.items():
        if bid not in fresh_ids and "gone_at" not in prior:
            table.update_item(
                Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"},
                UpdateExpression="SET gone_at = :g",
                ExpressionAttributeValues={":g": observed_at_ms},
            )

    for alert, text_hash in to_notify:
        _fan_out(table, alert, text_hash, observed_at_ms, counts)

    emit(**{k: v for k, v in counts.items() if v > 0})
    return {"sent": counts["EmailsSent"], "changed_bulletins": len(to_notify)}


def _recipients(table, alert) -> list[dict]:
    route_ids = alert.get("route_ids") or []
    if alert.get("all_routes") or not route_ids:
        route_ids = _all_route_ids()
    seen: dict[str, dict] = {}
    for rid in route_ids:
        for it in table.query(
            KeyConditionExpression=Key("PK").eq(f"ROUTE#{rid}") & Key("SK").begins_with("SUB#")
        )["Items"]:
            # One user may match via several routes/subs: keep one sub per
            # user (the first); the claim key is (user, bulletin) anyway.
            seen.setdefault(it["email"] + "|" + it["SK"].split("#")[1], it)
    return list(seen.values())


def _sub_matches(sub, sailings, parsed_clean, published_iso) -> tuple[bool, list]:
    start, end = sub["window_start"], sub["window_end"]
    if parsed_clean and sailings:
        mine = [s for s in sailings if s.dep_id == int(sub["dep"]) and start <= s.hhmm <= end]
        return bool(mine), mine
    if parsed_clean and not sailings:
        # Clean parse of a non-cancellation text (pure delay/status alert):
        # still route-relevant; apply the publish-time window rule.
        pass
    published = datetime.fromisoformat(published_iso).astimezone(SOUND_TZ)
    hhmm = published.strftime("%H:%M")
    lead = f"{max(0, int(start[:2]) - FALLBACK_LEAD_H):02d}{start[2:]}"
    return lead <= hhmm <= end, []


def _fan_out(table, alert, text_hash, observed_at_ms, counts) -> None:
    sailings, parsed_clean = parse_cancelled_sailings(alert.get("text"))
    if not parsed_clean:
        counts["ParseMisses"] += 1
        # The improvement loop's raw material: bulletin id + full text, one
        # CloudWatch query away (also durably in the raw S3 archive).
        print(json.dumps({"ParseMiss": {"bulletin_id": alert["id"], "text": alert.get("text")}}))
    la_date = datetime.now(SOUND_TZ).date().isoformat()

    for sub in _recipients(table, alert):
        matched, mine = _sub_matches(sub, sailings, parsed_clean, alert["published"])
        if not matched:
            continue
        user_sub = sub["SK"].split("#")[1]
        if not _claim(table, user_sub, alert["id"], text_hash, la_date, counts):
            continue
        try:
            _send(alert, sub, mine, parsed_clean)
            counts["EmailsSent"] += 1
            # Latency anchors on THIS invoke's observation - when this text
            # version reached our feed - which is what the p95 <= 2 min SLO
            # promises. Anchoring on the bulletin's stored first_seen_ms
            # reported 1.9 HOURS for a WSF edit re-notify (live, 2026-08-19,
            # bulletin 117241): bulletin age, not fan-out speed, poisoning
            # the SLO metric.
            latency_ms = int(time.time() * 1000) - observed_at_ms
            print(
                json.dumps(
                    {
                        "AlertSend": {
                            "bulletin_id": alert["id"],
                            "user": user_sub,
                            "latency_ms": latency_ms,
                            "parsed": parsed_clean and bool(mine),
                        }
                    }
                )
            )
            emit_latency(latency_ms)
        except Exception as exc:  # one bad recipient never aborts the fan-out
            counts["SendFailures"] += 1
            print(json.dumps({"SendFailure": {"bulletin_id": alert["id"], "error": str(exc)}}))


def _claim(table, user_sub, bulletin_id, text_hash, la_date, counts) -> bool:
    try:
        table.update_item(
            Key={"PK": f"USER#{user_sub}", "SK": f"SENT#{bulletin_id}"},
            UpdateExpression=(
                "SET last_hash = :h, send_count = if_not_exists(send_count, :z) + :one, "
                "expires_at = :ttl"
            ),
            ConditionExpression=(
                "attribute_not_exists(last_hash) OR (last_hash <> :h AND send_count < :cap)"
            ),
            ExpressionAttributeValues={
                ":h": text_hash,
                ":z": 0,
                ":one": 1,
                ":cap": MAX_SENDS_PER_BULLETIN,
                ":ttl": int(time.time()) + BULLETIN_TTL_S,
            },
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        counts["BulletinFlapping"] += 1  # cap hit or same text re-offered
        return False
    try:
        table.update_item(
            Key={"PK": f"USER#{user_sub}", "SK": f"NOTIF#{la_date}"},
            UpdateExpression="SET sends = if_not_exists(sends, :z) + :one, expires_at = :ttl",
            ConditionExpression="attribute_not_exists(sends) OR sends < :cap",
            ExpressionAttributeValues={
                ":z": 0,
                ":one": 1,
                ":cap": DAILY_CAP,
                ":ttl": int(time.time()) + 3 * 86400,
            },
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return False
    return True


def _send(alert, sub, mine, parsed_clean) -> None:
    site = os.environ["SITE_ORIGIN"]
    token = sign(
        {"u": sub["SK"].split("#")[1]},
        purpose="unsub",
        secret=next(iter(_link_secrets().values())),
        kid=next(iter(_link_secrets().keys())),
    )
    unsub_url = f"{os.environ['API_ORIGIN']}/v1/unsubscribe?token={token}"
    trip_url = f"{site}/trip/{sub.get('slug', '')}"

    lines = [alert["title"], "", alert.get("text") or ""]
    if mine:
        lines += ["", "Affected sailings in your window:"]
        lines += [f"  - {s.hhmm} {s.dep_code} > {s.arr_code}" for s in mine]
    elif not parsed_clean:
        lines += [
            "",
            "We couldn't determine the specific sailings from WSF's notice - "
            "check your route before you leave.",
        ]
    lines += [
        "",
        f"Your sailings: {trip_url}",
        "WSF service alerts: https://wsdot.wa.gov/travel/washington-state-ferries/service-alerts",
        f"Source: WSF bulletin {alert['id']}",
        "",
        f"Unsubscribe from all Ferry Sound alerts: {unsub_url}",
        f"Manage subscriptions: {site}/alerts",
    ]

    msg = EmailMessage()
    msg["From"] = os.environ["FROM_ADDRESS"]
    msg["To"] = sub["email"]
    msg["Subject"] = f"Ferry alert: {sub['dep_name']} → {sub['arr_name']}"
    msg["References"] = f"<bulletin-{alert['id']}@ferrysound.com>"
    msg["List-Unsubscribe"] = f"<{unsub_url}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content("\n".join(lines))

    _ses_send(sub["email"], msg.as_bytes())


def _ses_send(to_address: str, mime_bytes: bytes) -> None:
    boto3.client("sesv2").send_email(
        FromEmailAddress=os.environ["FROM_ADDRESS"],
        Destination={"ToAddresses": [to_address]},
        Content={"Raw": {"Data": mime_bytes}},
        ConfigurationSetName=os.environ["SES_CONFIGURATION_SET"],
    )
