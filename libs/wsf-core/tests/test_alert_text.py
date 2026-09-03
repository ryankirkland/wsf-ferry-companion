from wsf_core.alert_text import alert_details, fold

# The same cases as web/tests/unit/alert-text.test.ts - one rule, two renderers.

KALEETAN = "Sea/Brem -Update: ADA Alert - Kaleetan passenger elevator is available"
LABOR_DAY = "Service during Labor Day weekend"


def test_text_that_repeats_the_title_is_dropped():
    assert alert_details(KALEETAN, KALEETAN) == []
    assert (
        alert_details(
            "Edm/King - Boarding pass required daily, 8 a.m. to 8 p.m. through Oct.12",
            "Edm/King- Boarding pass required daily, 8 a.m. to 8 p.m. through Oct.12.",
        )
        == []
    )
    assert (
        alert_details(
            "Muk/Clin - ADA Alert - Suquamish #1 elevator is out of service",
            "ADA Alert - Suquamish #1 elevator is out of service",
        )
        == []
    )


def test_the_labor_day_email_shape_prints_the_title_once():
    # Bulletin 117482, 2026-09-03: title == text, no body ingested.
    assert alert_details(LABOR_DAY, LABOR_DAY) == []
    assert alert_details(LABOR_DAY, None, None) == []
    assert alert_details("Sea/Brem - ADA Alert", " - . ", "   ") == []


def test_texts_that_extend_the_title_are_kept_in_order():
    text = "FVS #2 - Missing crew. The 0405 VASH>FAU, 0425 FAU>SW and 0500 SW>VASH are cancelled."
    body = (
        "The #2 Cathlamet will be out of service, due to missing USCG regulated level of crewing."
    )
    assert alert_details("FVS #2 CATHLAMET out of service start of 7/24", text, body) == [
        text,
        body,
    ]
    extended = "Edm/King - Vessel #1 running late. View the Real-Time Map."
    assert alert_details("Edm/King - Vessel #1 running late", extended) == [extended]


def test_body_that_restates_the_text_wins_and_exact_duplicates_print_once():
    text = "Holiday schedule in effect."
    body = "Holiday schedule in effect. Sailings on Monday follow the Sunday timetable."
    assert alert_details(LABOR_DAY, text, body) == [body]
    assert alert_details(LABOR_DAY, body, body) == [body]


def test_numbers_never_fold_together():
    text = "Sea/Brem - ADA Alert - Chimacum #1 Elevator Out of Service"
    assert alert_details("Sea/Brem - ADA Alert - Chimacum #2 Elevator Out of Service", text) == [
        text
    ]
    assert (
        fold("Edm/King- Vessel #1.") == fold("Edm/King - Vessel #1") != fold("Edm/King - Vessel #2")
    )


def test_kept_texts_are_trimmed_but_not_reformatted():
    kept = alert_details(
        "Ana/SJs - vessel out of service", "  Ana/SJs - the 1:30 sailing is cancelled.  "
    )
    assert kept == ["Ana/SJs - the 1:30 sailing is cancelled."]
