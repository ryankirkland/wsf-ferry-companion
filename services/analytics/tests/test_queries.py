"""The SQL behind every published statistic.

These assert STRUCTURE, not semantics: without a Trino engine they cannot
prove a query returns the right rows. What they can prove is that the
honesty conventions survive an edit - the sailed-denominator guard, the
window pairing, the sample floor - and that a cutoff date always reaches
the SQL as a real date. The semantic check is a run against Athena, which
is a deploy-time step (see docs/features/stats.md), not a CI one.
"""

import re

import pytest
from wsf_analytics import queries

CUTOFF = "2026-05-02"

# Every query that reports on sailings, with the grouping it exists to do.
AGGREGATES = {
    "slots": queries.slots(CUTOFF),
    "hours": queries.hours(CUTOFF),
    "pairs": queries.pairs(CUTOFF),
    "system": queries.system(CUTOFF),
    "vessels": queries.vessels(CUTOFF),
    "seasons": queries.seasons(),
    "months": queries.months(),
    "bounds": queries.data_bounds(),
}
ALL = {
    **AGGREGATES,
    "recent_days": queries.recent_days(CUTOFF),
    "sailed": queries.sailed_slots(CUTOFF),
}


@pytest.mark.parametrize("name", sorted(ALL))
def test_every_query_reads_the_history_table(name):
    assert re.search(r"\bFROM history\b", ALL[name]), name


@pytest.mark.parametrize("name", sorted(AGGREGATES))
def test_on_time_is_measured_over_sailed_departures(name):
    """The denominator is departures that happened. Drop this guard and a
    sailing that never left would count as one that left late."""
    assert "actual_depart IS NOT NULL" in AGGREGATES[name], name


@pytest.mark.parametrize("name", ["slots", "hours", "pairs", "system", "vessels"])
def test_windowed_queries_report_both_windows_with_their_own_counts(name):
    sql = AGGREGATES[name]
    for column in ("n_all", "ontime_all", "p50_all", "p90_all", "n_win", "ontime_win"):
        assert f"AS {column}" in sql, f"{name} is missing {column}"


@pytest.mark.parametrize("name", ["slots", "hours", "pairs", "system", "vessels"])
def test_the_recent_window_filters_on_the_cutoff_that_was_passed(name):
    sql = AGGREGATES[name]
    assert f"DATE '{CUTOFF}'" in sql, name
    # FILTER is what lets one scan answer both windows; without it the
    # "recent" columns would silently repeat the all-time ones.
    assert "FILTER (WHERE" in sql, name


def test_on_time_threshold_comes_from_the_published_constant():
    # The contract tells readers "within N minutes"; the SQL must use the
    # same N, or the page describes a rule the numbers do not follow.
    assert f"delay_min <= {queries.ONTIME_MIN}" in queries.pairs(CUTOFF)
    assert queries.ONTIME_MIN == 10


def test_slots_are_limited_to_ones_the_window_actually_ran():
    """24 years of retired 06:10 sailings would otherwise ride into a
    contract describing today's schedule."""
    assert "HAVING" in queries.slots(CUTOFF)


def test_the_system_query_returns_a_rollup_row_alongside_the_years():
    # GROUPING SETS gives the headline and the 24-year trend in one scan;
    # stats.py finds the rollup by year IS NULL.
    assert "GROUPING SETS ((), (year))" in queries.system(CUTOFF)


def test_seasons_cover_the_whole_calendar_exactly_once():
    months = re.findall(r"month\(service_date\) IN \(([\d, ]+)\)", queries.SEASON_CASE)
    listed = sorted(int(m) for group in months for m in group.split(","))
    # Three seasons are listed and the fourth is the ELSE; every month must
    # appear at most once or a sailing lands in two seasons.
    assert len(listed) == len(set(listed))
    assert set(listed) <= set(range(1, 13))
    assert "ELSE 'fall'" in queries.SEASON_CASE


def test_the_slot_sample_floor_matches_the_contract():
    # stats.py degrades below this and the page prints the same number.
    assert queries.MIN_SLOT_SAMPLE == 30


def test_a_cutoff_always_reaches_the_sql_as_a_quoted_date():
    """A cutoff that arrived unquoted or unformatted would be a syntax
    error at 03:30 in the morning, on a night nobody is watching."""
    for name, sql in ALL.items():
        for literal in re.findall(r"DATE '([^']*)'", sql):
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", literal), f"{name}: {literal!r}"


def test_no_query_interpolates_an_unbounded_scan():
    # The workgroup caps bytes scanned, but a SELECT * would still drag the
    # whole corpus through Athena for a nightly job.
    for name, sql in ALL.items():
        assert "SELECT *" not in sql, name
