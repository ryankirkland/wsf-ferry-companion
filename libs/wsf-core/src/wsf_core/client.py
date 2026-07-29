"""HTTP client for the WSDOT Ferries Traveler Information API.

Failure signatures (verified 2026-07-24): auth failure is HTTP 400 with a
JSON body containing "Message" - this API has no 401/403. Unknown query
params are silently ignored; bad path values return 200 with []. Callers
decide what an empty collection means (for vessellocations it is a failure
to alarm on, never to retry-storm).
"""

import json
import re
from typing import Any

import urllib3

from wsf_core.models import TerminalLocation, VesselDim, VesselLocation

BASE_URL = "https://www.wsdot.wa.gov/ferries/api"
USER_AGENT = "ferrysound-ingest/1.0 (+https://ferrysound.com; contact: ryankirkland.py@gmail.com)"

SUB_APIS = ("vessels", "terminals", "schedule", "fares")


class WsfApiError(Exception):
    """Transport failure or non-2xx response other than the auth signature."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class WsfAuthError(WsfApiError):
    """400 + Message matching the auth signature ("access code" / "register")."""


class WsfBadRequestError(WsfApiError):
    """400 + Message that is NOT auth: non-adjacent fare pair, out-of-range
    TripDate ("valid range begins..."). Discriminated so a bad request can
    never trip the auth canary."""


_AUTH_MESSAGE_RE = re.compile(r"access\s*code|register", re.IGNORECASE)


class WsfClient:
    def __init__(
        self,
        access_code: str,
        *,
        base_url: str = BASE_URL,
        timeout_s: float = 10.0,
        http: urllib3.PoolManager | None = None,
    ):
        self._access_code = access_code
        self._base_url = base_url.rstrip("/")
        self._http = http or urllib3.PoolManager(
            timeout=urllib3.Timeout(total=timeout_s),
            retries=False,  # retry policy belongs to the caller's failure taxonomy
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )

    def _get(self, path: str) -> Any:
        url = f"{self._base_url}{path}?apiaccesscode={self._access_code}"
        try:
            resp = self._http.request("GET", url)
        except Exception as exc:  # urllib3 raises a small zoo; one taxonomy bucket
            raise WsfApiError(f"transport failure for {path}: {exc}") from exc

        if resp.status == 400:
            try:
                body = json.loads(resp.data)
            except (ValueError, TypeError):
                body = {}
            if isinstance(body, dict) and "Message" in body:
                message = str(body["Message"])
                if _AUTH_MESSAGE_RE.search(message):
                    raise WsfAuthError(f"{path}: {message}", status=400)
                raise WsfBadRequestError(f"{path}: {message}", status=400)
            raise WsfApiError(f"{path}: HTTP 400 without Message body", status=400)
        if resp.status != 200:
            raise WsfApiError(f"{path}: HTTP {resp.status}", status=resp.status)
        try:
            return json.loads(resp.data)
        except ValueError as exc:
            raise WsfApiError(f"{path}: non-JSON 200 response") from exc

    def vessel_locations_raw(self) -> list[dict]:
        """Unparsed rows - what the raw archive preserves (every field, junk included)."""
        return self._get("/vessels/rest/vessellocations")

    def vessel_locations(self) -> list[VesselLocation]:
        return [VesselLocation.model_validate(r) for r in self.vessel_locations_raw()]

    def vessel_dims_raw(self) -> list[dict]:
        return self._get("/vessels/rest/vesselverbose")

    def vessel_dims(self) -> list[VesselDim]:
        return [VesselDim.from_verbose(r) for r in self.vessel_dims_raw()]

    def terminal_locations_raw(self) -> list[dict]:
        return self._get("/terminals/rest/terminallocations")

    def terminal_locations(self) -> list[TerminalLocation]:
        return [TerminalLocation.model_validate(r) for r in self.terminal_locations_raw()]

    def cache_flush_date(self, sub_api: str) -> str:
        """Raw .NET date string; compared as an opaque token for dim refresh."""
        if sub_api not in SUB_APIS:
            raise ValueError(f"unknown sub-api: {sub_api}")
        return self._get(f"/{sub_api}/rest/cacheflushdate")

    # --- M2 raw accessors (schedule + fares + alerts). Raw dicts by design:
    # the archive preserves them verbatim; typed parsing lives in
    # schedule.py / fares.py / alerts.py.

    def valid_date_range(self, sub_api: str) -> dict:
        if sub_api not in ("schedule", "fares"):
            raise ValueError(f"validdaterange not offered by: {sub_api}")
        return self._get(f"/{sub_api}/rest/validdaterange")

    def schedule_pair_raw(self, trip_date: str, dep: int, arr: int) -> dict:
        return self._get(f"/schedule/rest/schedule/{trip_date}/{dep}/{arr}")

    def terminals_and_mates_raw(self, trip_date: str) -> list[dict]:
        return self._get(f"/schedule/rest/terminalsandmates/{trip_date}")

    def route_details_raw(self, trip_date: str) -> list[dict]:
        return self._get(f"/schedule/rest/routedetails/{trip_date}")

    def timeadj_raw(self) -> list[dict]:
        return self._get("/schedule/rest/timeadj")

    def alerts_raw(self) -> list[dict]:
        return self._get("/schedule/rest/alerts")

    def fare_line_items_verbose_raw(self, trip_date: str) -> dict:
        return self._get(f"/fares/rest/farelineitemsverbose/{trip_date}")

    def terminal_combo_verbose_raw(self, trip_date: str) -> list[dict]:
        return self._get(f"/fares/rest/terminalcomboverbose/{trip_date}")
