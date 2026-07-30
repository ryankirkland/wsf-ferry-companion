from wsf_core.alert_parse import parse_cancelled_sailings


def test_fvs_sample_parses_fully():
    # Verbatim from the golden alerts sample (the exploration-night text).
    text = (
        "FVS #2 - Missing crew.  The 0405 VASH>FAU, 0425 FAU>SW and 0500 "
        "SW>VASH are cancelled.  Updates to be provided.  "
    )
    sailings, clean = parse_cancelled_sailings(text)
    assert clean is True
    assert [(s.hhmm, s.dep_id, s.arr_id) for s in sailings] == [
        ("04:05", 22, 9),
        ("04:25", 9, 20),
        ("05:00", 20, 22),
    ]


def test_three_digit_times_zero_pad():
    sailings, clean = parse_cancelled_sailings("The 405 VASH>FAU is cancelled.")
    assert clean and sailings[0].hhmm == "04:05"


def test_slash_separator():
    sailings, clean = parse_cancelled_sailings("The 1630 SEA/BBI sailing is cancelled")
    assert clean and sailings[0].dep_id == 7 and sailings[0].arr_id == 3


def test_unknown_code_fails_closed():
    sailings, clean = parse_cancelled_sailings("The 0405 XYZ>FAU is cancelled.")
    assert sailings == [] and clean is False


def test_partial_resolution_is_a_miss():
    # One good mention plus one unknown code: fall back entirely rather
    # than deliver a half-true "affected sailings" list.
    text = "The 0405 VASH>FAU and 0500 ZZZ>VASH are cancelled."
    sailings, clean = parse_cancelled_sailings(text)
    assert sailings == [] and clean is False


def test_cancellation_prose_without_sailings_is_a_miss():
    sailings, clean = parse_cancelled_sailings(
        "Sailings on the Fauntleroy triangle may be cancelled today due to crewing."
    )
    assert sailings == [] and clean is False


def test_non_cancellation_text_is_clean_and_empty():
    sailings, clean = parse_cancelled_sailings(
        "Vessels running an estimated 30-45 minutes behind schedule"
    )
    assert sailings == [] and clean is True
    assert parse_cancelled_sailings(None) == ([], True)


def test_absurd_time_fails_closed():
    sailings, clean = parse_cancelled_sailings("The 2905 VASH>FAU is cancelled.")
    assert sailings == [] and clean is False
