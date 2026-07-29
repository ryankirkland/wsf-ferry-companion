"""Verified WSDOT Ferries quirk handling - the one place these rules live.

Evidence for every rule: api-exploration-wsdot-ferries/wsdot-ferries.md and
facts.json (quirks section, severities blocker/corrupting).
"""

from datetime import UTC, datetime

from wsf_core.models import TerminalLocation, VesselLocation

# Eagle Harbor maintenance yard: appears in vessellocations.DepartingTerminalID
# but no terminals operation serves it - inner joins silently drop laid-up
# vessels without this synthetic row. Coordinates derived from the moored
# fleet's positions.
YARD_TERMINAL_ID = 122
EAGLE_HARBOR_TERMINAL = TerminalLocation(
    terminal_id=YARD_TERMINAL_ID,
    terminal_name="Eagle Harbor",
    terminal_abbrev="EAH",
    lat=47.6205,
    lon=-122.5145,
    synthetic=True,
)

# PRD F1: source timestamp older than 5 minutes is the stale state - shown
# desaturated with "as of h:mm", never plotted as live. Out-of-service boats
# have carried stamps up to 45 days old.
STALE_AFTER_S = 300

# routedetails.PassengerOnlyFlag is upstream-false for these routes: WSF's
# own fare tables sell vehicle line items on them, which self-contradicts
# the flag. Verified live 2026-07-29: RouteID 8 (pt-key, Port Townsend /
# Coupeville) has PassengerOnlyFlag=true while farelineitemsverbose for
# 17<->11 returns "Vehicle Length-Based" categories and the route takes
# vehicle reservations. Telling drivers a car ferry is passengers-only is
# the worse failure, so the flag is suppressed here.
FALSE_PASSENGER_ONLY_ROUTE_IDS = frozenset({8})


def age_seconds(loc: VesselLocation, now: datetime | None = None) -> int:
    """Age of the vessel's source timestamp, clamped at zero."""
    now = now or datetime.now(UTC)
    return max(0, int((now - loc.source_ts).total_seconds()))


def vessel_state(loc: VesselLocation, now: datetime | None = None) -> str:
    """Map marker state with fixed precedence: stale > yard > docked > underway.

    ``in_service`` is deliberately not part of the precedence - it is carried
    separately so a fresh out-of-service boat still badges honestly.
    """
    if age_seconds(loc, now) > STALE_AFTER_S:
        return "stale"
    if loc.dep_terminal_id == YARD_TERMINAL_ID:
        return "yard"
    if loc.at_dock:
        return "docked"
    return "underway"


def normalize_vessel_name(name: str) -> str:
    """Join-safe vessel name: history's bare endpoint spells 'WallaWalla'.

    Lowercase with all whitespace removed - the only normalization proven
    necessary by the exploration (n=148 name joins at 100% under this rule).
    """
    return "".join(name.split()).lower()
