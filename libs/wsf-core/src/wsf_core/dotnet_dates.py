"""Parsers for the API's .NET/WCF date strings.

Format: ``/Date(1784879746000-0700)/`` - the integer is epoch milliseconds
in UTC; the embedded offset is Pacific *display* information and flips with
DST, so it must be ignored for arithmetic (verified 2026-07-24, see
wsdot-ferries.md "All timestamps").
"""

import re
from datetime import UTC, datetime

_DOTNET_RE = re.compile(r"^/Date\((-?\d+)(?:[+-]\d{4})?\)/$")


def parse_dotnet_date(value: str | None) -> datetime | None:
    """Parse a .NET date string to an aware UTC datetime; None passes through."""
    if value is None:
        return None
    m = _DOTNET_RE.match(value)
    if m is None:
        raise ValueError(f"not a .NET date string: {value!r}")
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=UTC)
