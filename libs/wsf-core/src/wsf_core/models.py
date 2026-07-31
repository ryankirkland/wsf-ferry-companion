"""Pydantic models for the WSDOT Ferries payloads consumed by WSF services.

Field aliases mirror the upstream names exactly; snake_case attributes are
ours. ``extra="ignore"`` lets upstream add fields (and keeps the legacy
VesselWatch* junk out) - the raw archive preserves everything regardless.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.vessel_classes import class_slug

_DOTNET_FIELDS = ("left_dock", "eta", "scheduled_departure", "source_ts")


class VesselLocation(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    vessel_id: int = Field(alias="VesselID")
    vessel_name: str = Field(alias="VesselName")
    mmsi: int | None = Field(default=None, alias="Mmsi")
    dep_terminal_id: int = Field(alias="DepartingTerminalID")
    dep_terminal_name: str = Field(alias="DepartingTerminalName")
    dep_terminal_abbrev: str = Field(alias="DepartingTerminalAbbrev")
    arr_terminal_id: int | None = Field(default=None, alias="ArrivingTerminalID")
    arr_terminal_name: str | None = Field(default=None, alias="ArrivingTerminalName")
    arr_terminal_abbrev: str | None = Field(default=None, alias="ArrivingTerminalAbbrev")
    lat: float = Field(alias="Latitude")
    lon: float = Field(alias="Longitude")
    speed_kn: float = Field(alias="Speed")
    heading_deg: int = Field(alias="Heading")
    in_service: bool = Field(alias="InService")
    at_dock: bool = Field(alias="AtDock")
    left_dock: datetime | None = Field(default=None, alias="LeftDock")
    eta: datetime | None = Field(default=None, alias="Eta")
    eta_basis: str | None = Field(default=None, alias="EtaBasis")
    scheduled_departure: datetime | None = Field(default=None, alias="ScheduledDeparture")
    routes: list[str] = Field(alias="OpRouteAbbrev")
    position_num: int | None = Field(default=None, alias="VesselPositionNum")
    sort_seq: int = Field(alias="SortSeq")
    source_ts: datetime = Field(alias="TimeStamp")

    @field_validator(*_DOTNET_FIELDS, mode="before")
    @classmethod
    def _parse_dotnet(cls, v: object) -> object:
        if isinstance(v, str):
            return parse_dotnet_date(v)
        return v


class VesselDim(BaseModel):
    """The slice of /vesselverbose the product uses (dim JSON + detail card)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    vessel_id: int = Field(alias="VesselID")
    vessel_name: str = Field(alias="VesselName")
    vessel_abbrev: str = Field(alias="VesselAbbrev")
    class_name: str
    # ClassName, not the display name: "Issaquah" and "Issaquah 130" share
    # a display name but are different classes with different drawings.
    class_slug: str
    silhouette_url: str
    max_passengers: int = Field(alias="MaxPassengerCount")
    reg_deck_space: int = Field(alias="RegDeckSpace")
    tall_deck_space: int = Field(alias="TallDeckSpace")
    year_built: int = Field(alias="YearBuilt")
    year_rebuilt: int | None = Field(default=None, alias="YearRebuilt")
    length_text: str = Field(alias="Length")

    @classmethod
    def from_verbose(cls, row: dict) -> "VesselDim":
        """Flatten the nested Class block from a /vesselverbose row."""
        cls_block = row.get("Class") or {}
        return cls.model_validate(
            {
                **row,
                "class_name": cls_block.get("PublicDisplayName") or cls_block.get("ClassName", ""),
                "class_slug": class_slug(cls_block.get("ClassName", "")),
                "silhouette_url": cls_block.get("SilhouetteImg", ""),
            }
        )


class TerminalLocation(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", frozen=True)

    terminal_id: int = Field(alias="TerminalID")
    terminal_name: str = Field(alias="TerminalName")
    terminal_abbrev: str = Field(alias="TerminalAbbrev")
    lat: float = Field(alias="Latitude")
    lon: float = Field(alias="Longitude")
    synthetic: bool = False

    @field_validator("terminal_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        # "Coupeville " arrives with a trailing space (verified 2026-07-24).
        return v.strip()
