"""SES event handler: bounces and complaints drive automated suppression.

Complaint or permanent bounce -> write EMAIL#<email>/SUPPRESS and delete
every subscription (both item sides) via the EMAIL#/USER pointer. Subs
gone means the fan-out path never pays a per-recipient suppression read;
the SUPPRESS item is checked only at subscribe time. Transient bounces
and Delivery/Reject events are logged for the latency/audit trail only.
"""

import json
import time

from wsf_core.tokens import canonicalize_email

from wsf_notify.api import _table, remove_all_subscriptions

SUPPRESS_TYPES = {"Complaint", "Bounce"}


def _emails(message: dict) -> tuple[str, list[str]]:
    kind = message.get("eventType") or message.get("notificationType") or ""
    if kind == "Complaint":
        recs = message.get("complaint", {}).get("complainedRecipients", [])
        return kind, [r["emailAddress"] for r in recs]
    if kind == "Bounce":
        bounce = message.get("bounce", {})
        if bounce.get("bounceType") != "Permanent":
            return "TransientBounce", []
        return kind, [r["emailAddress"] for r in bounce.get("bouncedRecipients", [])]
    return kind, []


def lambda_handler(event, context):
    suppressed = 0
    for record in event.get("Records", []):
        message = json.loads(record["Sns"]["Message"])
        kind, emails = _emails(message)
        if kind not in SUPPRESS_TYPES or not emails:
            print(json.dumps({"SesEvent": {"type": kind, "acted": False}}))
            continue
        table = _table()
        for raw_email in emails:
            email = canonicalize_email(raw_email)
            pointer = table.get_item(Key={"PK": f"EMAIL#{email}", "SK": "USER"}).get("Item")
            removed = remove_all_subscriptions(pointer["user_sub"]) if pointer else 0
            table.put_item(
                Item={
                    "PK": f"EMAIL#{email}",
                    "SK": "SUPPRESS",
                    "reason": kind.lower(),
                    "suppressed_at": int(time.time()),
                }
            )
            suppressed += 1
            print(json.dumps({"SesEvent": {"type": kind, "acted": True, "subs_removed": removed}}))
    return {"suppressed": suppressed}
