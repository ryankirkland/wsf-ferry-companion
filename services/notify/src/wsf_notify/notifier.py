"""Bulletin diff, subscription matching, and SQS delivery orchestration.

Invoked by the alerts poller with the full slimmed feed on every digest
change. The notifier owns bulletin state and matching, then enqueues one
retryable delivery per matched user. Bulletin state is written only after all
messages for that text version reach SQS; a crash therefore degrades to queue
duplicates, which the delivery worker absorbs after a successful send.
"""

import json
import os
import time
from dataclasses import asdict
from datetime import datetime
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from wsf_core.alert_parse import parse_cancelled_sailings
from wsf_core.alerts import body_hash, text_hash

from wsf_notify.metrics import emit

SOUND_TZ = ZoneInfo("America/Los_Angeles")
FALLBACK_LEAD_H = 2
BULLETIN_TTL_S = 90 * 86400
# An unchanged bulletin gets its TTL pushed out once it is this close to
# expiry - so a notice that outlives 90 days is never deleted and re-sent.
TTL_REFRESH_BELOW_S = 30 * 86400

_index_cache: dict | None = None


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _all_route_ids() -> list[int]:
    global _index_cache
    if _index_cache is None:
        _index_cache = json.loads(
            boto3.client("s3")
            .get_object(Bucket=os.environ["DATA_BUCKET"], Key="data/pairs/index.json")["Body"]
            .read()
        )
    return sorted({p["route_id"] for p in _index_cache["pairs"] if p.get("route_id") is not None})


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

    if not feed and stored:
        print(json.dumps({"EmptyFeedGuard": {"stored": len(stored)}}))
        return {"queued": 0, "guarded": True}

    counts = {"DeliveriesQueued": 0, "ParseMisses": 0, "BodyOnlyEdits": 0}
    fresh_ids: set[str] = set()
    changes: list[tuple[dict, str, str, int]] = []
    body_edits: list[tuple[str, str, bool]] = []
    ttl_refreshes: list[str] = []
    now_s = int(time.time())

    for alert in feed:
        bid = str(alert["id"])
        fresh_ids.add(bid)
        published_ms = int(datetime.fromisoformat(alert["published"]).timestamp() * 1000)
        version = text_hash(alert["title"], alert.get("text"))
        body_version = body_hash(alert.get("body"))
        prior = stored.get(bid)
        if prior:
            prior_ms = int(prior["published_ms"])
            if prior_ms > published_ms:
                continue
            if prior_ms == published_ms and prior.get("text_hash") == version:
                if prior.get("body_hash") != body_version:
                    # Title/text unchanged, body moved (or is seen for the
                    # first time by a notifier that stored no body_hash):
                    # republished on the site, metered, never re-notified.
                    body_edits.append((bid, body_version, "body_hash" in prior))
                elif int(prior.get("expires_at") or 0) < now_s + TTL_REFRESH_BELOW_S:
                    # Unchanged, but its 90-day TTL is running out. A
                    # long-lived notice (the Kingston boarding-pass shape)
                    # must not be TTL-deleted, come back as NEW, and
                    # re-email everyone. One write per bulletin per ~60
                    # days, not per poll.
                    ttl_refreshes.append(bid)
                continue
        changes.append((alert, version, body_version, published_ms))

    for alert, version, body_version, published_ms in changes:
        _enqueue_matches(table, alert, version, observed_at_ms, counts)
        _record_bulletin(table, alert, version, body_version, published_ms, observed_at_ms)

    for bid, body_version, known in body_edits:
        _record_body_hash(table, bid, body_version)
        if known:
            counts["BodyOnlyEdits"] += 1
            print(json.dumps({"BodyOnlyEdit": {"bulletin_id": bid}}))

    for bid in ttl_refreshes:
        _refresh_ttl(table, bid)

    for bid, prior in stored.items():
        if bid not in fresh_ids and "gone_at" not in prior:
            table.update_item(
                Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"},
                UpdateExpression="SET gone_at = :g",
                ExpressionAttributeValues={":g": observed_at_ms},
            )

    emit(**{key: value for key, value in counts.items() if value > 0})
    return {"queued": counts["DeliveriesQueued"], "changed_bulletins": len(changes)}


def _record_bulletin(
    table,
    alert: dict,
    version: str,
    body_version: str,
    published_ms: int,
    observed_at_ms: int,
) -> None:
    bid = str(alert["id"])
    try:
        table.update_item(
            Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"},
            UpdateExpression=(
                "SET published_ms = :p, text_hash = :h, body_hash = :b, route_ids = :r, "
                "all_routes = :a, first_seen_ms = if_not_exists(first_seen_ms, :seen), "
                "expires_at = :ttl REMOVE gone_at"
            ),
            ConditionExpression=(
                "attribute_not_exists(published_ms) OR published_ms < :p "
                "OR (published_ms = :p AND text_hash <> :h)"
            ),
            ExpressionAttributeValues={
                ":p": published_ms,
                ":h": version,
                ":b": body_version,
                ":r": alert.get("route_ids") or [],
                ":a": bool(alert.get("all_routes")),
                ":seen": observed_at_ms,
                ":ttl": int(time.time()) + BULLETIN_TTL_S,
            },
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Reserved concurrency serializes normal invocations. This path is a
        # duplicate or stale manual invoke; any queued duplicate is harmless.


def _record_body_hash(table, bid: str, body_version: str) -> None:
    """Body-only edit: move the stored body version (and push the TTL out)
    without touching the notification key, so the next poll does not
    re-count it."""
    _update_seen(
        table,
        bid,
        "SET body_hash = :b, expires_at = :ttl",
        {":b": body_version, ":ttl": int(time.time()) + BULLETIN_TTL_S},
    )


def _refresh_ttl(table, bid: str) -> None:
    _update_seen(table, bid, "SET expires_at = :ttl", {":ttl": int(time.time()) + BULLETIN_TTL_S})


def _update_seen(table, bid: str, expression: str, values: dict) -> None:
    """A write against a bulletin we just read. The condition only fails if
    the item was TTL-deleted between the query and now; that bulletin then
    reappears as NEW on the next poll, which is the right outcome, and
    raising would only trip the fan-out alarm for a non-event."""
    try:
        table.update_item(
            Key={"PK": "ALERTS", "SK": f"BULLETIN#{bid}"},
            UpdateExpression=expression,
            ConditionExpression="attribute_exists(published_ms)",
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise


def _subscriptions_by_user(table, alert: dict) -> dict[str, list[dict]]:
    route_ids = alert.get("route_ids") or []
    if alert.get("all_routes") or not route_ids:
        route_ids = _all_route_ids()

    grouped: dict[str, dict[str, dict]] = {}
    for route_id in sorted(set(route_ids)):
        kwargs = {
            "KeyConditionExpression": Key("PK").eq(f"ROUTE#{route_id}")
            & Key("SK").begins_with("SUB#")
        }
        while True:
            response = table.query(**kwargs)
            for item in response["Items"]:
                user_sub = item["SK"].split("#")[1]
                grouped.setdefault(user_sub, {})[item["SK"]] = item
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            kwargs["ExclusiveStartKey"] = last_key
    return {user: list(items.values()) for user, items in grouped.items()}


def _sub_matches(sub, sailings, parsed_clean, published_iso) -> tuple[bool, list]:
    start, end = sub["window_start"], sub["window_end"]
    if parsed_clean and sailings:
        mine = [
            sailing
            for sailing in sailings
            if sailing.dep_id == int(sub["dep"])
            and sailing.arr_id == int(sub["arr"])
            and start <= sailing.hhmm <= end
        ]
        return bool(mine), mine
    if parsed_clean and not sailings:
        # A non-cancellation status alert remains route-relevant; apply the
        # publish-time window rule rather than pretending a sailing was parsed.
        pass
    published = datetime.fromisoformat(published_iso).astimezone(SOUND_TZ)
    hhmm = published.strftime("%H:%M")
    lead = f"{max(0, int(start[:2]) - FALLBACK_LEAD_H):02d}{start[2:]}"
    return lead <= hhmm <= end, []


def _enqueue_matches(table, alert, version, observed_at_ms, counts) -> None:
    sailings, parsed_clean = parse_cancelled_sailings(alert.get("text"), alert.get("body"))
    if not parsed_clean:
        counts["ParseMisses"] += 1
        print(
            json.dumps(
                {
                    "ParseMiss": {
                        "bulletin_id": alert["id"],
                        "text": alert.get("text"),
                        "body": alert.get("body"),
                    }
                }
            )
        )

    for user_sub, subscriptions in _subscriptions_by_user(table, alert).items():
        matched_subs: list[dict] = []
        matched_sailings: dict[tuple, object] = {}
        for sub in subscriptions:
            matched, mine = _sub_matches(sub, sailings, parsed_clean, alert["published"])
            if not matched:
                continue
            matched_subs.append(sub)
            for sailing in mine:
                key = (sailing.hhmm, sailing.dep_id, sailing.arr_id)
                matched_sailings[key] = sailing
        if not matched_subs:
            continue

        first = matched_subs[0]
        matches = []
        seen_pairs: set[tuple[int, int]] = set()
        for sub in matched_subs:
            pair = (int(sub["dep"]), int(sub["arr"]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            matches.append(
                {
                    "dep": pair[0],
                    "arr": pair[1],
                    "dep_name": sub["dep_name"],
                    "arr_name": sub["arr_name"],
                    "slug": sub["slug"],
                }
            )

        payload = {
            "v": 1,
            "user_sub": user_sub,
            "email": first["email"],
            "text_hash": version,
            "observed_at_ms": observed_at_ms,
            "alert": alert,
            "parsed_clean": parsed_clean,
            "sailings": [asdict(sailing) for sailing in matched_sailings.values()],
            "subscription_ids": [
                sub["SK"].removeprefix(f"SUB#{user_sub}#") for sub in matched_subs
            ],
            "subscription": matches[0],
            "matches": matches,
        }
        _enqueue_delivery(payload)
        counts["DeliveriesQueued"] += 1


def _enqueue_delivery(payload: dict) -> None:
    boto3.client("sqs").send_message(
        QueueUrl=os.environ["DELIVERY_QUEUE_URL"],
        MessageBody=json.dumps(payload, separators=(",", ":")),
    )
