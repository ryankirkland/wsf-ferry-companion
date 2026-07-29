from datetime import UTC, datetime

import pytest
from wsf_core.dotnet_dates import parse_dotnet_date


def test_epoch_ms_is_utc_and_offset_ignored():
    # Same instant spelled with PDT and PST display offsets must parse equal.
    pdt = parse_dotnet_date("/Date(1784879746000-0700)/")
    pst = parse_dotnet_date("/Date(1784879746000-0800)/")
    assert pdt == pst
    assert pdt == datetime.fromtimestamp(1784879746, tz=UTC)
    assert pdt.tzinfo is not None


def test_positive_offset_and_no_offset():
    assert parse_dotnet_date("/Date(0+0100)/") == datetime(1970, 1, 1, tzinfo=UTC)
    assert parse_dotnet_date("/Date(0)/") == datetime(1970, 1, 1, tzinfo=UTC)


def test_none_passes_through():
    assert parse_dotnet_date(None) is None


@pytest.mark.parametrize("bad", ["", "2026-07-24", "/Date()/", "/Date(abc)/", "Date(0)"])
def test_invalid_raises(bad):
    with pytest.raises(ValueError):
        parse_dotnet_date(bad)
