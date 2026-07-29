"""Schedule sub-API models: pair schedules and timeadj adjustments.

Verified semantics (exploration 2026-07-24 + probes 2026-07-29):
- /schedule/{date}/{dep}/{arr} Times carry REAL dated timestamps
  (timeadj-applied); ArrivingTime is always null; a TripDate is a SERVICE
  day with a post-midnight tail (00:15/01:35 rows dated the next calendar
  day).
- Annotations are plain strings ("Via Southworth, crossing time 45
  minutes."), indexed positionally by Times[].AnnotationIndexes - probed
  live on fauntleroy-vashon. Parse defensively anyway.
- timeadj rows identify sailings by route/terminal/time-of-day (a 1900-PST
  sentinel) over a date range; AdjType 1=add, 2=cancel; no time-change type
  exists (retime = cancel+add).
"""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wsf_core.dotnet_dates import parse_dotnet_date

_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(value: str) -> str:
    """Upstream embeds HTML (incl. an unquoted-attribute anchor in fare
    labels) - always reduce to plain text, never render upstream markup."""
    return _TAG_RE.sub("", value).strip()


class Sailing(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    departing_time: datetime = Field(alias="DepartingTime")
    vessel_id: int = Field(alias="VesselID")
    vessel_name: str = Field(alias="VesselName")
    accessible: bool = Field(alias="VesselHandicapAccessible")
    position_num: int | None = Field(default=None, alias="VesselPositionNum")
    loading_rule: int = Field(alias="LoadingRule")
    routes: list[int] = Field(alias="Routes")
    annotation_indexes: list[int] = Field(alias="AnnotationIndexes")

    @field_validator("departing_time", mode="before")
    @classmethod
    def _parse(cls, v: object) -> object:
        return parse_dotnet_date(v) if isinstance(v, str) else v

    @property
    def depart_ms(self) -> int:
        """The verified join key: equals vessellocations.ScheduledDeparture ms."""
        return int(self.departing_time.timestamp() * 1000)


class PairSchedule(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    schedule_id: int = Field(alias="ScheduleID")
    schedule_name: str = Field(alias="ScheduleName")
    dep_terminal_id: int
    arr_terminal_id: int
    sailings: list[Sailing]
    annotations: list[str]

    @classmethod
    def from_envelope(cls, envelope: dict, dep: int, arr: int) -> "PairSchedule":
        combo = next(
            c
            for c in envelope["TerminalCombos"]
            if c["DepartingTerminalID"] == dep and c["ArrivingTerminalID"] == arr
        )
        annotations = []
        for a in combo.get("Annotations") or []:
            # Probed: plain strings. Defend against shape drift regardless.
            if isinstance(a, str):
                annotations.append(strip_html(a))
            elif isinstance(a, dict):
                text = a.get("AnnotationIVRText") or a.get("AnnotationText") or ""
                annotations.append(strip_html(str(text)))
            else:  # pragma: no cover - log-worthy surprise, skip content
                annotations.append("")
        return cls(
            ScheduleID=envelope["ScheduleID"],
            ScheduleName=envelope["ScheduleName"],
            dep_terminal_id=dep,
            arr_terminal_id=arr,
            sailings=[Sailing.model_validate(t) for t in combo["Times"]],
            annotations=annotations,
        )


class TimeAdjustment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    route_id: int = Field(alias="RouteID")
    terminal_id: int = Field(alias="TerminalID")
    time_to_adj: str = Field(alias="TimeToAdj")  # 1900 sentinel, parsed by caller
    adj_date_from: datetime = Field(alias="AdjDateFrom")
    adj_date_thru: datetime = Field(alias="AdjDateThru")
    adj_type: int = Field(alias="AdjType")  # 1=add, 2=cancel
    tidal: bool = Field(alias="TidalAdj")
    vessel_id: int = Field(alias="VesselID")
    journey_id: int = Field(alias="JourneyID")

    @field_validator("adj_date_from", "adj_date_thru", mode="before")
    @classmethod
    def _parse(cls, v: object) -> object:
        return parse_dotnet_date(v) if isinstance(v, str) else v

    @property
    def is_cancellation(self) -> bool:
        return self.adj_type == 2
