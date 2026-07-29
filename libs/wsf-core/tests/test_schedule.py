from datetime import date, time

from wsf_core.dotnet_dates import attach_service_date, parse_dotnet_time_of_day
from wsf_core.schedule import PairSchedule, TimeAdjustment, strip_html


def test_pair_envelope_parses(schedule_pair_envelope):
    pair = PairSchedule.from_envelope(schedule_pair_envelope, 7, 3)
    assert pair.schedule_name == "Summer 2026"
    assert len(pair.sailings) == 23
    first = pair.sailings[0]
    assert first.vessel_name in ("Tacoma", "Wenatchee")
    assert first.departing_time.tzinfo is not None
    # The verified join-key invariant: ms round-trips exactly.
    assert first.depart_ms == int(first.departing_time.timestamp() * 1000)


def test_service_day_tail_is_next_calendar_day(schedule_pair_envelope):
    """A TripDate is a service day: its last sailings are past midnight."""
    pair = PairSchedule.from_envelope(schedule_pair_envelope, 7, 3)
    from zoneinfo import ZoneInfo

    local_dates = {
        s.departing_time.astimezone(ZoneInfo("America/Los_Angeles")).date() for s in pair.sailings
    }
    assert len(local_dates) == 2  # the 00:15 / 01:35 tail


def test_annotations_parse_as_strings():
    envelope = {
        "ScheduleID": 196,
        "ScheduleName": "Summer 2026",
        "TerminalCombos": [
            {
                "DepartingTerminalID": 9,
                "ArrivingTerminalID": 22,
                "Annotations": ["Via Southworth, crossing time <i>45</i> minutes."],
                "Times": [],
            }
        ],
    }
    pair = PairSchedule.from_envelope(envelope, 9, 22)
    assert pair.annotations == ["Via Southworth, crossing time 45 minutes."]


def test_timeadj_row_semantics(timeadj_rows):
    adj = TimeAdjustment.model_validate(timeadj_rows[0])
    assert adj.is_cancellation and adj.tidal
    tod = parse_dotnet_time_of_day(timeadj_rows[0]["TimeToAdj"])
    assert tod == time(6, 30)  # the verified sentinel example
    # Single-date adjustment; recombination is tz-aware (PDT date + PST sentinel).
    local = attach_service_date(tod, date(2026, 8, 9))
    assert local.isoformat() == "2026-08-09T06:30:00-07:00"


def test_sentinel_rejects_real_dates():
    import pytest

    with pytest.raises(ValueError, match="sentinel"):
        parse_dotnet_time_of_day("/Date(1784896200000-0700)/")  # a real 2026 date


def test_strip_html_handles_unquoted_attrs():
    ugly = 'Senior / <a href=https://x target="_blank" title="Disability">Disability</a>'
    assert strip_html(ugly) == "Senior / Disability"
