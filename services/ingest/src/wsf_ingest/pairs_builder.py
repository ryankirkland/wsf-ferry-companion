"""Pure builders for the M2 public contracts (trip-planner.md, all "v":1).

No AWS, no HTTP - everything testable from golden samples. The handler in
schedule_refresh.py does the fetching/writing.
"""

import re
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from wsf_core import parse_dotnet_time_of_day
from wsf_core.fares import PairFares
from wsf_core.quirks import FALSE_PASSENGER_ONLY_ROUTE_IDS
from wsf_core.schedule import PairSchedule, TimeAdjustment

SOUND_TZ = ZoneInfo("America/Los_Angeles")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_pairs_index(
    *,
    mates: list[dict],
    route_details: list[dict],
    pair_routes: dict[tuple[int, int], int | None],
    terminals: list[dict],
    schedule_meta: dict,
    horizon_from: date,
    horizon_days: int,
    now: datetime,
) -> dict:
    """/data/pairs/index.json - the 38-pair system map.

    routedetails carries no terminal linkage; each pair's route_id is
    derived by the handler from the pair's own day-0 envelope
    (Times[].Routes) and passed in via pair_routes.
    """
    routes_by_id = {rd["RouteID"]: rd for rd in route_details}

    term_names = {t["TerminalID"]: t["Description"].strip() for t in terminals} if terminals else {}

    pairs = []
    for m in mates:
        dep, arr = m["DepartingTerminalID"], m["ArrivingTerminalID"]
        dep_name = (m.get("DepartingDescription") or term_names.get(dep, str(dep))).strip()
        arr_name = (m.get("ArrivingDescription") or term_names.get(arr, str(arr))).strip()
        route = pair_routes.get((dep, arr))
        crossing = None
        if route is not None:
            raw = routes_by_id.get(route, {}).get("CrossingTime")
            crossing = int(raw) if raw not in (None, "") else None
        pairs.append(
            {
                "dep": dep,
                "arr": arr,
                "dep_name": dep_name,
                "arr_name": arr_name,
                "slug": f"{slugify(dep_name)}-{slugify(arr_name)}",
                "route_id": route,
                "crossing_min": crossing,
                "reservable": bool(routes_by_id.get(route, {}).get("ReservationFlag"))
                if route
                else False,
                "passenger_only": bool(routes_by_id.get(route, {}).get("PassengerOnlyFlag"))
                if route and route not in FALSE_PASSENGER_ONLY_ROUTE_IDS
                else False,
            }
        )

    return {
        "v": 1,
        "generated_at": _iso(now),
        "schedule_id": schedule_meta.get("ScheduleID"),
        "schedule_name": schedule_meta.get("ScheduleName"),
        "horizon": {
            "from": horizon_from.isoformat(),
            "to": (horizon_from + timedelta(days=horizon_days - 1)).isoformat(),
        },
        "terminals": [
            {"id": tid, "name": name, "slug": slugify(name)}
            for tid, name in sorted(term_names.items())
        ],
        "pairs": pairs,
    }


def build_pair_day(
    *,
    pair_schedule: PairSchedule,
    service_date: date,
    crossing_min: int | None,
    route_id: int | None,
    route_pair_count: int,
    adjustments: list[TimeAdjustment],
    prev_day_keys: set[tuple[int, int]],
    now: datetime,
) -> tuple[dict, set[tuple[int, int]]]:
    """One /data/pairs/{dep}-{arr}/{date}.json + this day's dedup keys.

    prev_day_keys: (vessel_id, depart_ms) already published for the PRIOR
    service day - the post-midnight tail dedup (a TripDate's last sailings
    are dated the next calendar day and reappear in the next file).
    """
    sailings = []
    keys: set[tuple[int, int]] = set()
    for s in pair_schedule.sailings:
        key = (s.vessel_id, s.depart_ms)
        if key in prev_day_keys:
            continue
        keys.add(key)
        local = s.departing_time.astimezone(SOUND_TZ)
        sailings.append(
            {
                "depart": _iso(s.departing_time),
                "depart_ms": s.depart_ms,
                "vessel_id": s.vessel_id,
                "vessel": s.vessel_name,
                "pos_num": s.position_num,
                "accessible": s.accessible,
                "loading_rule": s.loading_rule,
                "after_midnight": local.date() != service_date,
                "added": False,
                "notes": [
                    pair_schedule.annotations[i]
                    for i in s.annotation_indexes
                    if 0 <= i < len(pair_schedule.annotations)
                ],
            }
        )

    adj_out = []
    for adj in adjustments:
        if route_id is None or adj.route_id != route_id:
            continue
        if adj.terminal_id != pair_schedule.dep_terminal_id:
            continue
        if not (adj.adj_date_from.date() <= service_date <= adj.adj_date_thru.date()):
            continue
        tod = parse_dotnet_time_of_day(adj.time_to_adj)
        matched = route_pair_count <= 2  # two-terminal routes are unambiguous
        if adj.adj_type == 1:
            # Addition: the sailing already appears in Times; badge it.
            add_ms = int(datetime.combine(service_date, tod, tzinfo=SOUND_TZ).timestamp() * 1000)
            for row in sailings:
                if row["depart_ms"] == add_ms:
                    row["added"] = True
        adj_out.append(
            {
                "type": "add" if adj.adj_type == 1 else "cancel",
                "time_local": tod.strftime("%H:%M"),
                "terminal_id": adj.terminal_id,
                "tidal": adj.tidal,
                "matched": matched,
            }
        )

    day = {
        "v": 1,
        "generated_at": _iso(now),
        "pair": {"dep": pair_schedule.dep_terminal_id, "arr": pair_schedule.arr_terminal_id},
        "service_date": service_date.isoformat(),
        "schedule_id": pair_schedule.schedule_id,
        "crossing_min": crossing_min,
        "sailings": sailings,
        "adjustments": adj_out,
    }
    return day, keys


def build_pair_fares(
    *, fares: PairFares, trip_date: date, retrieved_at: datetime, source_token: str
) -> dict:
    """/data/fares/{dep}-{arr}.json - honest effective labeling included."""

    def items(rows):
        return [
            {
                "id": i.id,
                "label": i.label,
                "category": i.category,
                "direction_independent": i.direction_independent,
                "amount": str(i.amount),
                "basic": i.basic,
            }
            for i in rows
        ]

    return {
        "v": 1,
        "generated_at": _iso(retrieved_at),
        "pair": {"dep": fares.dep_terminal_id, "arr": fares.arr_terminal_id},
        "trip_date": trip_date.isoformat(),
        "retrieved_at": _iso(retrieved_at),
        "source_token": source_token,
        "collection": fares.collection,
        "one_way": items(fares.one_way),
        "round_trip": items(fares.round_trip),
    }


def build_adjustments_doc(
    *,
    adjustments: list[TimeAdjustment],
    route_details: list[dict],
    from_date: date,
    now: datetime,
) -> dict:
    """/data/adjustments.json - the season-wide service calendar.

    One entry per (calendar date, adjustment): multi-day ranges are expanded
    so the client never does date-range math. Past dates are dropped; the
    upstream feed keeps rows for the whole season either way.
    """
    names = {rd["RouteID"]: rd.get("Description") for rd in route_details}
    out = []
    for adj in adjustments:
        tod = parse_dotnet_time_of_day(adj.time_to_adj)
        d = max(adj.adj_date_from.date(), from_date)
        thru = adj.adj_date_thru.date()
        while d <= thru:
            out.append(
                {
                    "date": d.isoformat(),
                    "route_id": adj.route_id,
                    "route_name": names.get(adj.route_id),
                    "terminal_id": adj.terminal_id,
                    "type": "add" if adj.adj_type == 1 else "cancel",
                    "tidal": adj.tidal,
                    "time_local": tod.strftime("%H:%M"),
                }
            )
            d += timedelta(days=1)
    out.sort(key=lambda a: (a["date"], a["route_id"], a["time_local"]))
    return {"v": 1, "generated_at": _iso(now), "from": from_date.isoformat(), "adjustments": out}
