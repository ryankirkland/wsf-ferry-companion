"""HTTP client for the WSDOT Ferries Traveler Information API.

Failure signatures (verified 2026-07-24): auth failure is HTTP 400 with a
JSON body containing "Message" - this API has no 401/403. Unknown query
params are silently ignored; bad path values return 200 with []. Callers
decide what an empty collection means (for vessellocations it is a failure
to alarm on, never to retry-storm).
"""

import json
import re
import ssl
import time
from importlib import resources
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


def _tls_context() -> ssl.SSLContext:
    """Default trust plus the DigiCert intermediate WSDOT stopped serving.

    Since their 2026-08-19 maintenance, www.wsdot.wa.gov presents a bare
    leaf certificate with no intermediate. Browsers repair that via AIA
    chasing; strict clients correctly fail CERTIFICATE_VERIFY_FAILED - a
    36 h outage that looked exactly like a cloud-IP block. Loading the
    intermediate locally keeps FULL verification: the chain must still
    anchor at a trusted root. See certs/digicert-ev-rsa-ca-g2.pem for
    provenance; remove both once WSDOT serves a complete chain.
    """
    ctx = ssl.create_default_context()
    pem = resources.files("wsf_core").joinpath("certs/digicert-ev-rsa-ca-g2.pem")
    ctx.load_verify_locations(cadata=pem.read_text())
    return ctx


class WsfClient:
    def __init__(
        self,
        access_code: str,
        *,
        base_url: str = BASE_URL,
        timeout_s: float = 10.0,
        transport_retries: int = 0,
        http: urllib3.PoolManager | None = None,
    ):
        self._access_code = access_code
        self._base_url = base_url.rstrip("/")
        # Retry policy belongs to the caller's failure taxonomy: the vessel
        # poller treats a failed poll as a data point (default 0), while the
        # schedule refresher opts into one transport retry - a single 10 s
        # read timeout must not abort a 532-call horizon rebuild (it did, on
        # 2026-07-30). Only transport failures retry; HTTP 4xx/5xx never do.
        self._transport_retries = transport_retries
        self._http = http or urllib3.PoolManager(
            timeout=urllib3.Timeout(total=timeout_s),
            retries=False,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ssl_context=_tls_context(),
        )

    def _get(self, path: str) -> Any:
        url = f"{self._base_url}{path}?apiaccesscode={self._access_code}"
        resp = None
        for attempt in range(self._transport_retries + 1):
            try:
                resp = self._http.request("GET", url)
                break
            except Exception as exc:  # urllib3 raises a small zoo; one taxonomy bucket
                if attempt >= self._transport_retries:
                    raise WsfApiError(f"transport failure for {path}: {exc}") from exc
                time.sleep(0.5 * (attempt + 1))
        assert resp is not None

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

    def vessel_history_raw(self, vessel_name: str, date_start: str, date_end: str) -> list[dict]:
        """UNDOCUMENTED endpoint; the M4 backfill workhorse. One row per
        completed crossing; join on the NAME (VesselId is corrupt there);
        a bad/unknown name returns 200 [] indistinguishable from an empty
        window - callers must alarm on suspicious emptiness.

        Name quirk (probed live 2026-07-30): spaces must be REMOVED, not
        percent-encoded - "WallaWalla" returns 8,157 rows for 2015 while
        "Walla%20Walla" silently returns []. Same for "Evergreen" (the
        Evergreen State sails under its short name here)."""
        compact = vessel_name.replace(" ", "")
        return self._get(f"/vessels/rest/vesselhistory/{compact}/{date_start}/{date_end}")

    def terminal_sailing_space_raw(self) -> list[dict]:
        """Current-state drive-up space for the subset of terminals that
        report it; empty overnight. History exists only via our snapshots."""
        return self._get("/terminals/rest/terminalsailingspace")

    def fare_line_items_verbose_raw(self, trip_date: str) -> dict:
        return self._get(f"/fares/rest/farelineitemsverbose/{trip_date}")

    def terminal_combo_verbose_raw(self, trip_date: str) -> list[dict]:
        return self._get(f"/fares/rest/terminalcomboverbose/{trip_date}")
