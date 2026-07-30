import pytest
from wsf_core.tokens import TokenError, canonicalize_email, sign, verify

SECRETS = {"k1": "old-secret", "k2": "current-secret"}
NOW = 1_800_000_000


def make(purpose="unsub", kid="k2", claims=None, now_s=NOW):
    return sign(
        claims or {"email": "rider@example.com"},
        purpose=purpose,
        secret=SECRETS[kid],
        kid=kid,
        now_s=now_s,
    )


def test_roundtrip():
    token = make()
    claims = verify(token, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)
    assert claims["email"] == "rider@example.com"
    assert claims["p"] == "unsub" and claims["kid"] == "k2"


def test_wrong_purpose_rejected():
    # A verify-link token must never work against the unsubscribe endpoint.
    token = make(purpose="verify")
    with pytest.raises(TokenError, match="purpose"):
        verify(token, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)


def test_rotation_previous_key_still_verifies():
    token = make(kid="k1")
    claims = verify(token, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)
    assert claims["kid"] == "k1"
    with pytest.raises(TokenError, match="unknown key"):
        verify(token, purpose="unsub", secrets={"k2": SECRETS["k2"]}, max_age_s=None, now_s=NOW)


def test_tampered_payload_rejected():
    token = make()
    payload, mac = token.split(".")
    tampered = payload[:-2] + ("AA" if payload[-2:] != "AA" else "BB") + "." + mac
    with pytest.raises(TokenError):
        verify(tampered, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)


def test_expiry():
    token = make(now_s=NOW - 100_000)
    with pytest.raises(TokenError, match="expired"):
        verify(token, purpose="unsub", secrets=SECRETS, max_age_s=86_400, now_s=NOW)
    # Non-expiring mode (one-click unsubscribe) still verifies.
    verify(token, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)


def test_malformed_tokens():
    for bad in ("", "just-one-part", "a.b.c", "!!!.???"):
        with pytest.raises(TokenError):
            verify(bad, purpose="unsub", secrets=SECRETS, max_age_s=None, now_s=NOW)


def test_canonicalize_email():
    assert canonicalize_email("  Rider@Example.COM ") == "rider@example.com"
    # '#' is legal in local parts - canonical form keeps it (keys must never
    # be derived by splitting on '#').
    assert canonicalize_email("a#b@example.com") == "a#b@example.com"
    for bad in ("", "nope", "two@@example.com", "@example.com", "user@nodot"):
        with pytest.raises(TokenError):
            canonicalize_email(bad)
