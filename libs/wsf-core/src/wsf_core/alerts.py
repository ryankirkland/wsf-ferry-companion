"""Schedule alerts: the only same-day operational truth in this API.

RouteAlertText is free text with terminal abbreviations and 24-hour times
("The 0405 VASH>FAU ... are cancelled"); M2 surfaces it verbatim (plain
text) as route banners - structured parsing is M3's job.
"""

import hashlib
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.schedule import strip_html


class Alert(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    id: int = Field(alias="BulletinID")
    title: str = Field(alias="AlertFullTitle")
    text: str | None = Field(default=None, alias="RouteAlertText")
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


_WS_RE = re.compile(r"\s+")


def alert_text_hash(alert: Alert) -> str:
    """Hash of exactly what a notification email would render (title + text),
    whitespace-normalized: upstream is Word-paste HTML soup, and a
    whitespace-only edit must not count as an update."""
    title = _WS_RE.sub(" ", alert.title).strip()
    text = _WS_RE.sub(" ", alert.text or "").strip()
    return hashlib.sha256(f"{title}\n{text}".encode()).hexdigest()[:16]


def alerts_watermark(alerts: list[Alert]) -> str:
    """Change-detection token: digest over every (id, published, text) tuple.

    The M2 version was max(id):max(published_ms), which is blind to edits of
    older bulletins and to withdrawals (a retracted alert lowers neither max)
    - withdrawn alerts stayed on the site banner indefinitely. The digest
    moves whenever ANY bulletin appears, changes, or disappears. Format is
    prefixed so the one spurious "changed" poll at cutover is legible.
    """
    if not alerts:
        return "d:empty"
    tuples = sorted((a.id, int(a.published.timestamp() * 1000), alert_text_hash(a)) for a in alerts)
    joined = "|".join(f"{i}:{ms}:{h}" for i, ms, h in tuples)
    return "d:" + hashlib.sha256(joined.encode()).hexdigest()[:24]
