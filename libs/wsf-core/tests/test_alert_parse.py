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


def test_body_prose_is_read_and_fails_closed():
    title_only = "Service during Labor Day weekend"
    # A status bulletin: nothing to extract, nothing missed - no caveat.
    assert parse_cancelled_sailings(title_only, "Sailings follow the Sunday schedule.") == (
        [],
        True,
    )
    # The cancellation lives only in the body, in prose the codes regex
    # cannot read: a MISS, so the notifier falls back honestly.
    body = "Due to crewing, the 5:30 p.m. Seattle to Bainbridge sailing is cancelled."
    assert parse_cancelled_sailings(title_only, body) == ([], False)
    # Codes in the one-liner still parse when the body says nothing about it.
    sailings, clean = parse_cancelled_sailings(
        "The 1630 SEA>BBI sailing is cancelled.", "The #1 vessel is out of service."
    )
    assert clean and [s.hhmm for s in sailings] == ["16:30"]
    # Body only (no one-liner at all) is read too.
    sailings, clean = parse_cancelled_sailings(None, "The 1630 SEA>BBI sailing is cancelled.")
    assert clean and len(sailings) == 1


def test_body_noise_cannot_demote_a_clean_one_liner():
    # Review finding, 2026-09-03: folding the body into the same pass let a
    # body with slashes and abbreviations ("WSDOT/WSF", "104 EB/WB") turn a
    # one-liner that parsed cleanly into a miss - and a miss falls back to
    # the publish-time window, which can DROP the rider whose window covers
    # the cancelled sailing. The one-liner wins whenever it has something.
    text = "The 0405 VASH>FAU and 0425 FAU>SW are cancelled."
    body = "See the 2026 WSDOT/WSF notice for SR 104 EB/WB detours."
    sailings, clean = parse_cancelled_sailings(text, body)
    assert clean is True
    assert [(s.hhmm, s.dep_id, s.arr_id) for s in sailings] == [("04:05", 22, 9), ("04:25", 9, 20)]


def test_body_is_consulted_only_when_the_one_liner_has_nothing():
    # One-liner repeats the title; the body carries the codes.
    sailings, clean = parse_cancelled_sailings(
        "Sea/BI - Service update", "Due to weather, the 1630 SEA>BBI sailing is cancelled."
    )
    assert clean is True and sailings[0].hhmm == "16:30"


def test_a_missed_one_liner_stays_a_miss_whatever_the_body_says():
    # Fail-closed: a cancellation mention the regex cannot resolve is a miss
    # even if the body happens to parse; the caveat must print.
    sailings, clean = parse_cancelled_sailings(
        "The 0405 XYZ>FAU is cancelled.", "The 1630 SEA>BBI sailing is cancelled."
    )
    assert sailings == [] and clean is False
