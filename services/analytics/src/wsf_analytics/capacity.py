"""Terminal drive-up capacity poller (M4 D1 recorder, W1 publisher).

24/7 on purpose: the feed is current-state only, so every unpolled minute
is history that never exists. Overnight responses archive as tiny objects
and keep re-verifying the only-some-terminals-report quirk.

The same fetch publishes /data/capacity.json (ADR-0005: the browser reads
a static file, never the upstream API). Measured over 319 snapshots /
9,111 departures on 2026-07-31:

- 13 terminals report, not the ~6 the plan assumed.
- 23 of the 38 published pairs ever carry capacity. The other 15 must
  read as "this terminal does not report drive-up space", never as "no
  space" or an empty gauge.
- DriveUpSpaceCount is never null; WSF's own DriveUpSpaceHexColor takes
  exactly three values, which is the fullness judgment they already make
  and we pass through rather than invent: #00FF00 plenty (7,739),
  #FFFF00 filling (962), #FF0000 full (410).
- Reservable space is a separate inventory and usually absent
  (ReservableSpaceCount null in 8,013 of 9,111), so no percent-full is
  published: spaces remaining is the honest number.
- Each departure carries a live IsCancelled flag - passed through, and
  distinct from the historical reconciliation in reconcile.py.
"""

import json
import os
from datetime import UTC, datetime

import boto3
from wsf_core import WsfClient
from wsf_core.dotnet_dates import parse_dotnet_date
from wsf_core.ssm import get_access_code

from wsf_analytics.metrics import emit

CAPACITY_KEY = "data/capacity.json"
CACHE_CONTROL = "public, max-age=30, must-revalidate"

# WSF's own fullness signal; unknown codes degrade to null rather than
# guessing a level the operator never published.
DRIVE_UP_LEVELS = {"#00FF00": "plenty", "#FFFF00": "filling", "#FF0000": "full"}

_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code())
    return _client


def build_contract(rows: list, now: datetime) -> dict:
    """Pair-keyed view: the trip page asks "space on MY run", not "space
    at this terminal"."""
    pairs: dict[str, list] = {}
    for terminal in rows or []:
        dep_id = terminal.get("TerminalID")
        for departure in terminal.get("DepartingSpaces") or []:
            departs = parse_dotnet_date(departure.get("Departure"))
            if departs is None:
                continue
            for space in departure.get("SpaceForArrivalTerminals") or []:
                entry = {
                    "depart_ms": int(departs.timestamp() * 1000),
                    "vessel": departure.get("VesselName"),
                    "cancelled": bool(departure.get("IsCancelled")),
                    "drive_up": space.get("DriveUpSpaceCount"),
                    "level": DRIVE_UP_LEVELS.get(space.get("DriveUpSpaceHexColor")),
                    "max_space": space.get("MaxSpaceCount") or departure.get("MaxSpaceCount"),
                    "reservable": space.get("ReservableSpaceCount"),
                }
                for arr_id in space.get("ArrivalTerminalIDs") or []:
                    pairs.setdefault(f"{dep_id}-{arr_id}", []).append(entry)

    for sailings in pairs.values():
        sailings.sort(key=lambda s: s["depart_ms"])

    return {
        "v": 1,
        "generated_at": now.isoformat(),
        # Absence is a fact about the terminal, not about space: the UI
        # needs to tell "no drive-up data published here" apart from "no
        # room left".
        "reporting_terminals": sorted(
            {t["TerminalID"] for t in rows or [] if t.get("TerminalID") is not None}
        ),
        "pairs": pairs,
    }


def lambda_handler(event, context):
    from wsf_core.archive import ArchiveBatch

    now = datetime.now(UTC)
    rows = _wsf().terminal_sailing_space_raw()
    s3 = boto3.client("s3")

    archive = ArchiveBatch(s3, os.environ["RAW_BUCKET"])
    archive.add(fetched_at=now, status=200, body=rows)
    key = archive.flush(dataset="terminalsailingspace")

    contract = build_contract(rows, now)
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key=CAPACITY_KEY,
        Body=json.dumps(contract, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl=CACHE_CONTROL,
    )

    counts = {"CapacityPublished": 1}
    if rows:
        counts["CapacityTerminalsReporting"] = len(rows)
    cancelled = sum(
        1 for t in rows or [] for d in t.get("DepartingSpaces") or [] if d.get("IsCancelled")
    )
    if cancelled:
        counts["CapacityCancelledDepartures"] = cancelled
    emit(**counts)
    return {"terminals": len(rows), "pairs": len(contract["pairs"]), "key": key}
