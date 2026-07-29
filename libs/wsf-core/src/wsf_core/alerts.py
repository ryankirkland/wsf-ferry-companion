"""Schedule alerts: the only same-day operational truth in this API.

RouteAlertText is free text with terminal abbreviations and 24-hour times
("The 0405 VASH>FAU ... are cancelled"); M2 surfaces it verbatim (plain
text) as route banners - structured parsing is M3's job.
"""

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


def alerts_watermark(alerts: list[Alert]) -> str:
    """Change-detection token: max id + max publish ms."""
    if not alerts:
        return "0:0"
    max_id = max(a.id for a in alerts)
    max_ms = max(int(a.published.timestamp() * 1000) for a in alerts)
    return f"{max_id}:{max_ms}"
