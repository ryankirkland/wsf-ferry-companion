"""Schedule alerts: the only same-day operational truth in this API.

WSF publishes three strings per bulletin. AlertFullTitle is the headline.
RouteAlertText is a one-liner that, for most bulletins, repeats the title
verbatim - but when WSF cancels sailings it is where the codes live ("The
0405 VASH>FAU ... are cancelled"), so it is the parser's first input and
the notification key. BulletinText (identical to HomepageAlertText, 9/9 in
the exploration sample) is the HTML long-form body and the only place the
substance of a status bulletin lives. It was dropped on ingest until
2026-09-03, which is why the Labor Day email (bulletin 117482) carried
nothing but its title, twice.
"""

import hashlib
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.html_text import html_to_text
from wsf_core.schedule import strip_html


class Alert(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    id: int = Field(alias="BulletinID")
    title: str = Field(alias="AlertFullTitle")
    text: str | None = Field(default=None, alias="RouteAlertText")
    body: str | None = Field(default=None, alias="BulletinText")
    published: datetime = Field(alias="PublishDate")
    route_ids: list[int] = Field(default_factory=list, alias="AffectedRouteIDs")
    all_routes: bool = Field(default=False, alias="AllRoutesFlag")

    @field_validator("published", mode="before")
    @classmethod
    def _parse(cls, v: object) -> object:
        return parse_dotnet_date(v) if isinstance(v, str) else v

    @field_validator("title", "text")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return strip_html(v) if isinstance(v, str) else v

    @field_validator("body")
    @classmethod
    def _body(cls, v: str | None) -> str | None:
        return html_to_text(v) if isinstance(v, str) else v


_WS_RE = re.compile(r"\s+")


def _norm(value: str | None) -> str:
    return _WS_RE.sub(" ", value or "").strip()


def text_hash(title: str, text: str | None) -> str:
    """The NOTIFICATION KEY, v1 - pinned.

    title + RouteAlertText, whitespace-normalized (upstream is Word-paste
    soup; a whitespace-only edit must not count as an update). The notifier
    stores it in ALERTS/BULLETIN#.text_hash, the delivery worker in
    USER#/SENT#.last_hash, and both compare against it on every poll. If its
    inputs ever move, every live bulletin looks edited on the first poll
    after deploy and every subscriber is re-emailed - so the body is
    deliberately NOT in here (see body_hash), and test_alerts pins the
    formula with a golden value.
    """
    return hashlib.sha256(f"{_norm(title)}\n{_norm(text)}".encode()).hexdigest()[:16]


def body_hash(body: str | None) -> str:
    """BulletinText version, tracked separately: a body-only edit republishes
    the site and is metered (BodyOnlyEdits) but does not re-notify - whether
    it should is a decision to take with that metric in hand, not by default."""
    return hashlib.sha256(_norm(body).encode()).hexdigest()[:16]


def alert_text_hash(alert: Alert) -> str:
    return text_hash(alert.title, alert.text)


def alerts_watermark(alerts: list[Alert]) -> str:
    """Change-detection token: digest over every (id, published, text, body).

    The M2 version was max(id):max(published_ms), which is blind to edits of
    older bulletins and to withdrawals (a retracted alert lowers neither max)
    - withdrawn alerts stayed on the site banner indefinitely. The digest
    moves whenever ANY bulletin appears, changes, or disappears - the body
    included, so a body-only edit reaches /data/alerts.json. Format is
    prefixed so the one spurious "changed" poll at cutover is legible.
    """
    if not alerts:
        return "d:empty"
    tuples = sorted(
        (a.id, int(a.published.timestamp() * 1000), alert_text_hash(a), body_hash(a.body))
        for a in alerts
    )
    joined = "|".join(f"{i}:{ms}:{h}:{b}" for i, ms, h, b in tuples)
    return "d:" + hashlib.sha256(joined.encode()).hexdigest()[:24]
