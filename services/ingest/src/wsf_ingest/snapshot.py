"""Build the versioned fleet.json snapshot - the map's public contract.

Schema "v": 1 is documented in ADR-0005 and consumed by web/src/lib/data.
Breaking changes require a new version, never a mutation.
"""

from datetime import UTC, datetime

from wsf_core import VesselLocation, age_seconds, vessel_state

SCHEMA_VERSION = 1


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_snapshot(fleet: list[VesselLocation], now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    return {
        "v": SCHEMA_VERSION,
        "generated_at": _iso(now),
        "vessels": [
            {
                "id": v.vessel_id,
                "name": v.vessel_name,
                "lat": v.lat,
                "lon": v.lon,
                "speed": v.speed_kn,
                "heading": v.heading_deg,
                "state": vessel_state(v, now),
                "insvc": v.in_service,
                "age_s": age_seconds(v, now),
                "dep": v.dep_terminal_id,
                "arr": v.arr_terminal_id,
                "left": _iso(v.left_dock),
                "eta": _iso(v.eta),
                "eta_basis": v.eta_basis,
                "sched": _iso(v.scheduled_departure),
                "routes": v.routes,
                "pos": v.position_num,
            }
            for v in sorted(fleet, key=lambda v: (v.sort_seq, v.vessel_id))
        ],
    }
