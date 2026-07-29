"""Parsers for the API's .NET/WCF date strings.

Format: ``/Date(1784879746000-0700)/`` - the integer is epoch milliseconds
in UTC; the embedded offset is Pacific *display* information and flips with
DST, so it must be ignored for arithmetic (verified 2026-07-24, see
wsdot-ferries.md "All timestamps").
"""

import re
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

_DOTNET_RE = re.compile(r"^/Date\((-?\d+)(?:[+-]\d{4})?\)/$")
_SOUND_TZ = ZoneInfo("America/Los_Angeles")


def parse_dotnet_date(value: str | None) -> datetime | None:
    """Parse a .NET date string to an aware UTC datetime; None passes through."""
    if value is None:
        return None
    m = _DOTNET_RE.match(value)
    if m is None:
        raise ValueError(f"not a .NET date string: {value!r}")
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=UTC)


def parse_dotnet_time_of_day(value: str) -> time:
    """Time-of-day from a 1900-01-01 PST sentinel (sailings.Time, timeadj.TimeToAdj).

    The epoch ms decodes to 1900-01-01 in Pacific; only the clock time is
    meaningful. Verified example: /Date(-2208936600000-0800)/ -> 06:30.
    """
    dt = parse_dotnet_date(value)
    assert dt is not None
    local = dt.astimezone(_SOUND_TZ)
    if local.year != 1900:
        raise ValueError(f"expected a 1900 sentinel, got {local.isoformat()} from {value!r}")
    return local.time()


def attach_service_date(t: time, service_date: date) -> datetime:
    """Recombine a sentinel time-of-day with a real service date, tz-aware.

    The sentinel is always PST (-0800) but the service date may be PDT, so
    the combination MUST go through the local calendar - never a fixed
    offset add.
    """
    return datetime.combine(service_date, t, tzinfo=_SOUND_TZ)
