"""DynamoDB hot-state writes with TimeStamp dedup.

Dedup is a module-lifetime in-memory cache, valid because the poller runs
with reserved concurrency 1 (single cache authority). Conditional writes were
rejected in ADR-0005: a failed condition check still bills a write unit.
"""

from datetime import UTC, datetime
from decimal import Decimal

from wsf_core import VesselLocation, vessel_state

META_PK = "META"
FLEET_PK = "FLEET"


def _num(value: float) -> Decimal:
    # DynamoDB numbers go through Decimal; str() keeps float repr exact enough.
    return Decimal(str(value))


def _iso(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def fleet_item(v: VesselLocation, now: datetime | None = None) -> dict:
    item = {
        "PK": FLEET_PK,
        "SK": f"VESSEL#{v.vessel_id:04d}",
        "vessel_id": v.vessel_id,
        "name": v.vessel_name,
        "lat": _num(v.lat),
        "lon": _num(v.lon),
        "speed_kn": _num(v.speed_kn),
        "heading": v.heading_deg,
        "at_dock": v.at_dock,
        "in_service": v.in_service,
        "state": vessel_state(v, now),
        "dep_terminal_id": v.dep_terminal_id,
        "routes": v.routes,
        "source_ts_utc": _iso(v.source_ts),
        "fetched_at_utc": _iso(now or datetime.now(UTC)),
    }
    # Nullable fields are omitted, not stored as None (semantic nulls).
    if v.arr_terminal_id is not None:
        item["arr_terminal_id"] = v.arr_terminal_id
    if v.left_dock is not None:
        item["left_dock_utc"] = _iso(v.left_dock)
    if v.eta is not None:
        item["eta_utc"] = _iso(v.eta)
    if v.eta_basis is not None:
        item["eta_basis"] = v.eta_basis
    if v.scheduled_departure is not None:
        item["sched_dep_utc"] = _iso(v.scheduled_departure)
    if v.position_num is not None:
        item["pos_num"] = v.position_num
    return item


class FleetWriter:
    def __init__(self, table):
        self._table = table
        self._seen_ts: dict[int, datetime] = {}

    def write_changed(self, fleet: list[VesselLocation], now: datetime | None = None) -> int:
        """Write only vessels whose source TimeStamp moved; returns count written."""
        changed = [v for v in fleet if self._seen_ts.get(v.vessel_id) != v.source_ts]
        if changed:
            with self._table.batch_writer() as batch:
                for v in changed:
                    batch.put_item(Item=fleet_item(v, now))
            for v in changed:
                self._seen_ts[v.vessel_id] = v.source_ts
        return len(changed)

    def write_meta(self, *, polls_ok: int, polls_failed: int, last_error: str | None) -> None:
        now = datetime.now(UTC)
        item = {
            "PK": META_PK,
            "SK": "POLLER#vessellocations",
            "last_attempt_utc": _iso(now),
            "polls_ok": polls_ok,
            "polls_failed": polls_failed,
        }
        if polls_ok:
            item["last_success_utc"] = _iso(now)
        if last_error:
            item["last_error"] = last_error[:1000]
        self._table.put_item(Item=item)
