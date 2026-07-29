"""Shared WSDOT Ferries API client, models, and quirk handling.

Every WSF service (ingest, api, alerts, history) goes through this package so
the API's verified quirks - .NET dates, staleness, terminal 122, name
normalization, the 400+Message auth signature - are handled in exactly one
place. See api-exploration-wsdot-ferries/wsdot-ferries.md for the evidence.
"""

from wsf_core.client import WsfApiError, WsfAuthError, WsfBadRequestError, WsfClient
from wsf_core.dotnet_dates import attach_service_date, parse_dotnet_date, parse_dotnet_time_of_day
from wsf_core.models import TerminalLocation, VesselDim, VesselLocation
from wsf_core.quirks import (
    EAGLE_HARBOR_TERMINAL,
    STALE_AFTER_S,
    YARD_TERMINAL_ID,
    age_seconds,
    normalize_vessel_name,
    vessel_state,
)

__all__ = [
    "EAGLE_HARBOR_TERMINAL",
    "STALE_AFTER_S",
    "YARD_TERMINAL_ID",
    "TerminalLocation",
    "VesselDim",
    "VesselLocation",
    "WsfApiError",
    "WsfAuthError",
    "WsfBadRequestError",
    "WsfClient",
    "age_seconds",
    "attach_service_date",
    "normalize_vessel_name",
    "parse_dotnet_date",
    "parse_dotnet_time_of_day",
    "vessel_state",
]
