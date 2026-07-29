from datetime import UTC, datetime, timedelta

from wsf_core.models import VesselLocation
from wsf_core.quirks import (
    EAGLE_HARBOR_TERMINAL,
    age_seconds,
    normalize_vessel_name,
    vessel_state,
)


def _fleet(vessellocations_rows):
    return [VesselLocation.model_validate(r) for r in vessellocations_rows]


def test_states_against_golden_sample(vessellocations_rows):
    """Anchor 'now' just after the snapshot's freshest stamp and check the
    real quirk cases: 45-day and 15-hour stale stamps, a fresh yard boat,
    the one underway vessel, and ordinary docked boats."""
    fleet = _fleet(vessellocations_rows)
    now = max(v.source_ts for v in fleet) + timedelta(seconds=10)
    by_name = {v.vessel_name: v for v in fleet}

    assert vessel_state(by_name["Sealth"], now) == "stale"  # 45 days old
    assert vessel_state(by_name["Walla Walla"], now) == "stale"  # ~16 h old
    assert vessel_state(by_name["Tokitae"], now) == "yard"  # fresh, at 122
    assert vessel_state(by_name["Chimacum"], now) == "underway"
    assert vessel_state(by_name["Yakima"], now) == "docked"


def test_stale_wins_over_yard(vessellocations_rows):
    fleet = _fleet(vessellocations_rows)
    sealth = next(v for v in fleet if v.vessel_name == "Sealth")
    assert sealth.dep_terminal_id == 122  # at the yard AND stale -> stale wins
    assert vessel_state(sealth) == "stale"


def test_age_clamps_at_zero(vessellocations_rows):
    v = _fleet(vessellocations_rows)[0]
    past = v.source_ts - timedelta(seconds=30)  # "now" before the stamp
    assert age_seconds(v, past) == 0
    assert age_seconds(v, v.source_ts + timedelta(seconds=42)) == 42


def test_name_normalization_bridges_history_spelling():
    assert normalize_vessel_name("Walla Walla") == normalize_vessel_name("WallaWalla")
    assert normalize_vessel_name(" Tacoma ") == "tacoma"


def test_synthetic_eagle_harbor_row():
    t = EAGLE_HARBOR_TERMINAL
    assert (t.terminal_id, t.terminal_abbrev, t.synthetic) == (122, "EAH", True)
    assert 47.5 < t.lat < 47.7 and -122.6 < t.lon < -122.4


def test_now_defaults_to_utc_now(vessellocations_rows):
    v = _fleet(vessellocations_rows)[0]
    # Sample was captured 2026-07-24; any real 'now' makes everything stale.
    assert vessel_state(v) == "stale"
    assert age_seconds(v) > 0
    assert datetime.now(UTC) > v.source_ts
