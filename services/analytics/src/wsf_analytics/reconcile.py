"""Cancellation by reconciliation (M4 D3).

vesselhistory has no cancelled flag - it reports departures that
happened. So "cancelled" here means what a rider experiences: a sailing
the published schedule promised for that day which never departed. We
diff the archived day-of pair-day schedules (raw/schedule_refresh) against
the sailings in the Parquet history.

THE MATCHING UNIT (measured 2026-07-31, and the whole reason this module
is subtle). The two sides count different things:

- The schedule's TerminalCombos are the RIDER'S JOURNEY: Anacortes ->
  Friday Harbor is listed even when the boat calls at Orcas first, and
  Fauntleroy -> Southworth is listed for a sailing that physically runs
  Fauntleroy -> Vashon -> Southworth.
- vesselhistory records the PHYSICAL LEG: that same sailing appears as
  Anacortes -> Orcas, or Fauntleroy -> Vashon.

Diffing full (departing, arriving) pairs therefore reads every multi-stop
journey as a cancellation. Measured on 2026-07-29 it produced a 19.8%
"cancellation" rate concentrated exactly where interlining happens - 80%
on Fauntleroy->Southworth, 83% on Orcas->Shaw - while the point-to-point
runs (Bainbridge, Bremerton, Edmonds-Kingston) came out clean. So we
match on (service_date, DEPARTING terminal, HH:MM): did a boat leave that
dock at that minute? That is also the question the rider is asking. Same
day, same method: 3.4% unmatched, scattered singletons.

Honesty rules baked in:
- Tracking starts the day the schedule archive starts (2026-07-29). No
  retroactive estimate of the prior 24 years.
- The comparison uses the LAST schedule snapshot taken on or before the
  end of that service day - the plan riders actually saw. A sailing
  cancelled far enough ahead that WSF pulled it from the schedule is
  invisible to this method, so the number is a floor, and the contract
  says so.
- Only COMPLETE service days are reconciled. The most recent day in the
  history is the day collection stopped partway through, and counting its
  un-fetched evening as cancelled turned a normal Thursday into 37%.
- A terminal-day with a schedule but ZERO reported departures is a
  collection gap, not a 100%-cancelled day: it counts as unreconciled and
  is reported, never averaged in.
- Departure-minute matching can absorb a real cancellation if two boats
  were scheduled out of one dock in the same minute and only one sailed.
  Rare, and it biases toward under-reporting, which is why the published
  number is labeled a floor.
"""

import gzip
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from wsf_core.dotnet_dates import parse_dotnet_date

SOUND_TZ = ZoneInfo("America/Los_Angeles")
TRACKING_FLOOR = date(2026, 7, 29)  # first day of schedule archiving
WINDOW_DAYS = 30
SCHEDULE_PREFIX = "raw/schedule_refresh/"


def _archive_keys(s3, bucket: str, days: list[date]) -> list[str]:
    # A snapshot taken Pacific-evening lands in the NEXT UTC dt partition,
    # so each service day needs its own dt and the following one.
    wanted = {d.isoformat() for d in days} | {(d + timedelta(days=1)).isoformat() for d in days}
    keys = []
    for prefix_day in sorted(wanted):
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket=bucket, Prefix=f"{SCHEDULE_PREFIX}dt={prefix_day}/"
        ):
            keys += [o["Key"] for o in page.get("Contents", [])]
    return keys


def scheduled_by_pair_day(s3, bucket: str, days: list[date]) -> dict[tuple, set[str]]:
    """(service_date, dep, arr) -> {HH:MM} from the last day-of snapshot."""
    best_at: dict[tuple, str] = {}
    slots: dict[tuple, set[str]] = {}
    wanted_days = {d.isoformat() for d in days}

    for key in _archive_keys(s3, bucket, days):
        blob = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        for line in gzip.decompress(blob).decode().strip().split("\n"):
            if not line:
                continue
            record = json.loads(line)
            body = record.get("body") or {}
            if "pair" not in body or body.get("date") not in wanted_days:
                continue
            service_day = date.fromisoformat(body["date"])
            fetched_at = record.get("fetched_at", "")
            # Only snapshots a rider could have seen that day count.
            deadline = datetime.combine(service_day, time(23, 59, 59), tzinfo=SOUND_TZ)
            try:
                if datetime.fromisoformat(fetched_at) > deadline:
                    continue
            except ValueError:
                continue

            dep, arr = body["pair"]
            entry = (body["date"], dep, arr)
            if best_at.get(entry, "") > fetched_at:
                continue
            times = set()
            for combo in (body.get("schedule") or {}).get("TerminalCombos", []):
                if (
                    combo.get("DepartingTerminalID") != dep
                    or combo.get("ArrivingTerminalID") != arr
                ):
                    continue
                for sailing in combo.get("Times", []):
                    departs = parse_dotnet_date(sailing.get("DepartingTime"))
                    if departs is None:
                        continue
                    local = departs.astimezone(SOUND_TZ)
                    if local.date() == service_day:
                        times.add(local.strftime("%H:%M"))
            best_at[entry] = fetched_at
            slots[entry] = times
    return slots


def reconcile(scheduled: dict[tuple, set[str]], sailed_rows: list[dict]) -> dict:
    """Diff scheduled vs sailed; returns system totals + per-pair rollups.

    Matching is by departure dock and minute (see the module docstring):
    the schedule sells journeys, the history logs legs.
    """
    departures: dict[tuple, set[str]] = defaultdict(set)
    for row in sailed_rows:
        departures[(str(row["service_date"]), row["dep"])].add(row["hhmm"])

    per_pair: dict[tuple, dict] = {}
    totals = {"scheduled": 0, "not_sailed": 0, "pair_days": 0, "unreconciled_days": 0}

    for entry, times in scheduled.items():
        service_day, dep, arr = entry
        if not times:
            continue
        pair = per_pair.setdefault(
            (dep, arr), {"scheduled": 0, "not_sailed": 0, "days": 0, "unreconciled_days": 0}
        )
        left_the_dock = departures.get((service_day, dep), set())
        if not left_the_dock:
            # Scheduled sailings, nothing reported from that dock all day:
            # a gap in collection, never evidence of a cancelled day.
            pair["unreconciled_days"] += 1
            totals["unreconciled_days"] += 1
            continue
        missing = len(times - left_the_dock)
        pair["scheduled"] += len(times)
        pair["not_sailed"] += missing
        pair["days"] += 1
        totals["scheduled"] += len(times)
        totals["not_sailed"] += missing
        totals["pair_days"] += 1

    return {"totals": _with_rate(totals), "pairs": {k: _with_rate(v) for k, v in per_pair.items()}}


def _with_rate(counts: dict) -> dict:
    scheduled = counts["scheduled"]
    return {
        **counts,
        "rate_pct": round(100.0 * counts["not_sailed"] / scheduled, 2) if scheduled else None,
    }


def window_days(data_through: date) -> list[date]:
    """Reconcilable days: COMPLETE days, within tracking, last 30.

    data_through is the day collection stopped partway through - its
    un-fetched evening would otherwise read as a wave of cancellations -
    so the window ends the day before it.
    """
    last = data_through - timedelta(days=1)
    first = max(TRACKING_FLOOR, last - timedelta(days=WINDOW_DAYS - 1))
    if last < first:
        return []
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]
