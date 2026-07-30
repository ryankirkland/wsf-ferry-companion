"""Signed tokens for email-borne links (M3, ADR-0006).

Even with Cognito handling sign-in, alert emails need links that work
without a session: RFC 8058 one-click unsubscribe happens inside mail
clients. Tokens are HMAC-SHA256 over a compact JSON payload that ALWAYS
includes purpose, kid, and version INSIDE the MAC - a verify token can
never be replayed against an unsubscribe endpoint, and key rotation is a
non-event (keep current+previous secrets keyed by kid in SSM).

Emails are canonicalized (trim + lowercase, documented choice) before
signing and before every DynamoDB key derivation - Foo@ and foo@ must be
one subscriber everywhere or self-service unsubscribe silently fails.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any


class TokenError(Exception):
    """Invalid, expired, or wrong-purpose token."""


def canonicalize_email(email: str) -> str:
    cleaned = email.strip().lower()
    if not cleaned or "@" not in cleaned or cleaned.count("@") != 1:
        raise TokenError("not an email address")
    local, domain = cleaned.split("@")
    if not local or "." not in domain:
        raise TokenError("not an email address")
    return cleaned


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(payload_b64: str, secret: str) -> str:
    return _b64(hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest())


def sign(
    claims: dict[str, Any],
    *,
    purpose: str,
    secret: str,
    kid: str,
    now_s: int | None = None,
) -> str:
    """Token = base64url(payload).base64url(hmac). Payload carries v, kid,
    purpose, iat plus the caller's claims."""
    payload = {"v": 1, "kid": kid, "p": purpose, "iat": now_s or int(time.time()), **claims}
    payload_b64 = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload_b64}.{_mac(payload_b64, secret)}"


def verify(
    token: str,
    *,
    purpose: str,
    secrets: dict[str, str],
    max_age_s: int | None,
    now_s: int | None = None,
) -> dict[str, Any]:
    """Returns the claims or raises TokenError. `secrets` maps kid -> secret
    (current + previous during rotation). max_age_s None = non-expiring
    (one-click unsubscribe links must keep working for months)."""
    try:
        payload_b64, mac_b64 = token.split(".")
        payload = json.loads(_unb64(payload_b64))
    except (ValueError, TypeError) as exc:
        raise TokenError("malformed token") from exc

    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise TokenError("unknown token version")
    kid = payload.get("kid")
    secret = secrets.get(kid) if isinstance(kid, str) else None
    if secret is None:
        raise TokenError("unknown key id")
    if not hmac.compare_digest(_mac(payload_b64, secret), mac_b64):
        raise TokenError("bad signature")
    if payload.get("p") != purpose:
        raise TokenError("wrong purpose")
    if max_age_s is not None:
        iat = payload.get("iat")
        if not isinstance(iat, int) or (now_s or int(time.time())) - iat > max_age_s:
            raise TokenError("expired")
    return payload
