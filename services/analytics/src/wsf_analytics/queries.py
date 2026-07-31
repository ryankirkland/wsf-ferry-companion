"""The nightly stats suite (M4 D3), mirroring the canonical spike queries
minus q4 - cancellation is a scheduled-vs-sailed reconciliation (see
reconcile.py), never a column, so a hardcoded false can never be served
as "0% cancellations".

Two conventions everywhere:
- ON-TIME means delay_min <= 10 over SAILED departures. Rows without an
  actual departure are excluded from the denominator rather than counted
  as late; today the API only reports departures that happened, but the
  guard keeps that assumption from silently rotting.
- Windows come in pairs (all-time + primary) via FILTER aggregates, so a
  single scan answers both and the contract can always print n for each.
  The 90-day cutoff is derived from the DATA's last service date, not
  wall-clock: if collection stalls, the window follows the evidence and
  freshness is reported separately.
"""

ONTIME_MIN = 10
PRIMARY_WINDOW_DAYS = 90
MIN_SLOT_SAMPLE = 30  # below this a slot degrades to its hour bucket

SEASON_CASE = """CASE
      WHEN month(service_date) IN (12, 1, 2) THEN 'winter'
      WHEN month(service_date) IN (3, 4, 5) THEN 'spring'
      WHEN month(service_date) IN (6, 7, 8) THEN 'summer'
      ELSE 'fall'
    END"""

_SAILED = "actual_depart IS NOT NULL"


def _windowed(cutoff: str) -> str:
    """all-time + primary-window aggregate columns for any grouping."""
    recent = f"service_date >= DATE '{cutoff}'"
    ontime = f"avg(CASE WHEN delay_min <= {ONTIME_MIN} THEN 1.0 ELSE 0.0 END)"
    return f"""
      count(*) AS n_all,
      round(100.0 * {ontime}, 1) AS ontime_all,
      round(approx_percentile(delay_min, 0.5), 1) AS p50_all,
      round(approx_percentile(delay_min, 0.9), 1) AS p90_all,
      count(*) FILTER (WHERE {recent}) AS n_win,
      round(100.0 * {ontime} FILTER (WHERE {recent}), 1) AS ontime_win,
      round(approx_percentile(delay_min, 0.5) FILTER (WHERE {recent}), 1) AS p50_win,
      round(approx_percentile(delay_min, 0.9) FILTER (WHERE {recent}), 1) AS p90_win"""


def data_bounds() -> str:
    return f"""
    SELECT max(service_date) AS through, min(service_date) AS since,
           count(*) AS rows_total, count(DISTINCT vessel_name) AS vessels
    FROM history WHERE {_SAILED}"""


def slots(cutoff: str) -> str:
    # Only slots the current schedule still runs can help a rider, and a
    # slot absent from the whole window is exactly that signal - so the
    # HAVING keeps 24 years of retired 6:10 sailings out of the contract.
    return f"""
    SELECT departing_terminal_id AS dep, arriving_terminal_id AS arr,
           depart_hhmm_local AS hhmm,{_windowed(cutoff)}
    FROM history WHERE {_SAILED}
    GROUP BY 1, 2, 3
    HAVING count(*) FILTER (WHERE service_date >= DATE '{cutoff}') > 0
    ORDER BY 1, 2, 3"""


def hours(cutoff: str) -> str:
    return f"""
    SELECT departing_terminal_id AS dep, arriving_terminal_id AS arr,
           substr(depart_hhmm_local, 1, 2) AS hh,{_windowed(cutoff)}
    FROM history WHERE {_SAILED}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3"""


def pairs(cutoff: str) -> str:
    return f"""
    SELECT departing_terminal_id AS dep, arriving_terminal_id AS arr,
           {_windowed(cutoff)}
    FROM history WHERE {_SAILED}
    GROUP BY 1, 2
    ORDER BY 1, 2"""


def seasons() -> str:
    return f"""
    SELECT departing_terminal_id AS dep, arriving_terminal_id AS arr,
           {SEASON_CASE} AS season,
           count(*) AS n,
           round(100.0 * avg(CASE WHEN delay_min <= {ONTIME_MIN} THEN 1.0 ELSE 0.0 END), 1)
             AS ontime,
           round(approx_percentile(delay_min, 0.9), 1) AS p90
    FROM history WHERE {_SAILED}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3"""


def system(cutoff: str) -> str:
    # GROUPING SETS: the year=NULL row is the all-system rollup, so one
    # scan yields the headline and the 24-year trend line together.
    return f"""
    SELECT year,{_windowed(cutoff)}
    FROM history WHERE {_SAILED}
    GROUP BY GROUPING SETS ((), (year))
    ORDER BY year"""


def vessels(cutoff: str) -> str:
    return f"""
    SELECT vessel_name,{_windowed(cutoff)}
    FROM history WHERE {_SAILED}
    GROUP BY 1
    ORDER BY 1"""


def months() -> str:
    return f"""
    SELECT month(service_date) AS month,
           count(*) AS n,
           round(100.0 * avg(CASE WHEN delay_min <= {ONTIME_MIN} THEN 1.0 ELSE 0.0 END), 1)
             AS ontime,
           round(approx_percentile(delay_min, 0.9), 1) AS p90
    FROM history WHERE {_SAILED}
    GROUP BY 1
    ORDER BY 1"""


def recent_days(since: str) -> str:
    """Coverage guard: a day whose row count collapses is a collection
    gap, and saying so beats quietly averaging a half-empty day in."""
    return f"""
    SELECT service_date, count(*) AS n, count(DISTINCT vessel_name) AS vessels
    FROM history
    WHERE service_date >= DATE '{since}'
    GROUP BY 1
    ORDER BY 1"""


def sailed_slots(since: str) -> str:
    """Reconciliation input: what actually sailed, per pair-day-slot."""
    return f"""
    SELECT service_date, departing_terminal_id AS dep, arriving_terminal_id AS arr,
           depart_hhmm_local AS hhmm
    FROM history
    WHERE service_date >= DATE '{since}' AND {_SAILED}"""
