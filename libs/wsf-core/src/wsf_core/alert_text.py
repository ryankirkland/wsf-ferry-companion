"""What to print under an alert's title.

WSF publishes three strings per bulletin and, for most of them, two are the
same sentence typed twice: AlertFullTitle and RouteAlertText drift only in
punctuation and spacing ("Edm/King- Boarding" vs "Edm/King - Boarding").
Printing both put the Labor Day title in the owner's inbox twice (bulletin
117482, 2026-09-03). This is the one rule for every renderer - the email
here, the banner in web/src/lib/trip/alert-text.ts (kept in lockstep): fold
case, punctuation and whitespace, drop a candidate the title or another
candidate already covers, keep everything that says something new. Keep
digits so "#1" and "#2" never fold together.
"""

import re

_FOLD_RE = re.compile(r"[^a-z0-9]+")


def fold(value: str) -> str:
    return _FOLD_RE.sub("", value.lower())


def alert_details(title: str, *candidates: str | None) -> list[str]:
    """The candidate texts (in the order given) that add to the title.

    A candidate is dropped when the title covers it, when another candidate
    strictly contains it (the body usually restates the one-liner in full),
    or when an earlier candidate equals it. Never drops a text that EXTENDS
    the title - that is where cancellations live."""
    texts = [(candidate or "").strip() for candidate in candidates]
    keys = [fold(text) for text in texts]
    title_key = fold(title)
    kept: list[str] = []
    for i, (text, key) in enumerate(zip(texts, keys, strict=True)):
        if not key or key in title_key:
            continue
        if any(key in other and (other != key or j < i) for j, other in enumerate(keys) if j != i):
            continue
        kept.append(text)
    return kept
