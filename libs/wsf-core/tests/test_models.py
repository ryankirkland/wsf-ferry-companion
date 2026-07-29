from wsf_core.models import TerminalLocation, VesselDim, VesselLocation


def test_vessellocations_full_sample_parses(vessellocations_rows):
    fleet = [VesselLocation.model_validate(r) for r in vessellocations_rows]
    assert len(fleet) == 21
    by_name = {v.vessel_name: v for v in fleet}

    yakima = by_name["Yakima"]
    assert yakima.vessel_id == 38
    assert yakima.dep_terminal_id == 1
    assert yakima.routes == ["ana-sj"]
    assert yakima.source_ts.tzinfo is not None

    # The one underway vessel in the overnight snapshot carries the full
    # non-null set; docked vessels' nulls are semantic and must pass through.
    chimacum = by_name["Chimacum"]
    assert chimacum.at_dock is False
    assert chimacum.left_dock is not None
    assert chimacum.eta is not None
    assert chimacum.speed_kn > 10


def test_out_of_service_markers(vessellocations_rows):
    fleet = [VesselLocation.model_validate(r) for r in vessellocations_rows]
    laid_up = [v for v in fleet if not v.in_service]
    assert len(laid_up) == 3
    for v in laid_up:
        assert v.position_num is None
        assert v.sort_seq == 9999
        assert v.routes == []


def test_vesselverbose_dims(vesselverbose_rows):
    dims = [VesselDim.from_verbose(r) for r in vesselverbose_rows]
    assert len(dims) == 21
    tacoma = next(d for d in dims if d.vessel_name == "Tacoma")
    assert tacoma.class_name
    assert tacoma.silhouette_url.startswith("https://")
    assert tacoma.max_passengers > 1000
    assert "'" in tacoma.length_text  # foot/inch string, not a number


def test_terminallocations(terminallocations_rows):
    terms = [TerminalLocation.model_validate(r) for r in terminallocations_rows]
    assert len(terms) == 20
    ids = {t.terminal_id for t in terms}
    assert 122 not in ids  # the yard gap is real
    coupeville = next(t for t in terms if t.terminal_id == 11)
    assert coupeville.terminal_name == "Coupeville"  # trailing space stripped
    seattle = next(t for t in terms if t.terminal_id == 7)
    assert seattle.terminal_abbrev == "P52"
