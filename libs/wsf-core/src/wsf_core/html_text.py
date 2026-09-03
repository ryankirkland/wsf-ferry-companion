"""Upstream HTML -> plain text for the alert body.

BulletinText is Word-paste HTML soup (<p><span data-contrast="none">,
&nbsp;, <a href>), and it is the ONLY field where WSF puts the substance
of a status bulletin - RouteAlertText usually repeats the title. This keeps
the paragraph structure (an email and a banner both need line breaks) and
nothing else: no markup, no attributes, no link targets. Our own links are
the calls to action; upstream markup is never rendered (same rule as
wsf_core.schedule.strip_html, which stays the title/text normalizer so the
notification hash inputs never move).
"""

import html
import re

_BLOCK_RE = re.compile(
    r"</?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>", re.IGNORECASE
)
_TAG_RE = re.compile(r"<[^>]+>")
_HSPACE_RE = re.compile(r"[^\S\n]+")  # every whitespace but newline, NBSP included
_BLANK_RUN_RE = re.compile(r"\n{3,}")


def html_to_text(value: str | None) -> str | None:
    """Block boundaries become newlines, everything else is stripped, entities
    are decoded AFTER stripping (so "&lt;b&gt;" stays literal text), runs of
    blank lines collapse to one. Empty after cleanup -> None: an absent body
    is a labeled absence, not an empty string."""
    if value is None:
        return None
    text = _BLOCK_RE.sub("\n", value)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text).replace("\r", "")
    text = _HSPACE_RE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_RUN_RE.sub("\n\n", text).strip()
    return text or None
