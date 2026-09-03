"""Free-text cancellation parsing (M3, ADR-0006).

WSF publishes per-sailing cancellations only as prose:
"FVS #2 - Missing crew.  The 0405 VASH>FAU, 0425 FAU>SW and 0500 SW>VASH
are cancelled."  This extracts (time, dep, arr) triples so subscriptions
with time windows match precisely. Strictly best-effort: an unknown code
or novel phrasing is a parse MISS, never a crash - the notifier falls
back to route-level delivery (missing a real cancellation is the worse
failure). ParseCoverage is measured from day one.

The abbreviation map is curated from observed alert texts and WSF
terminal pages; codes not listed here fail closed into the fallback.
"""

import re
from dataclasses import dataclass

# code -> TerminalID (schedule API ids, same space as the pairs index)
TERMINAL_CODES: dict[str, int] = {
    "ANA": 1,
    "BBI": 3,
    "BAIN": 3,
    "WIN": 3,  # Winslow, Bainbridge's historical name - appears in older texts
    "BRE": 4,
    "BREM": 4,
    "CLI": 5,
    "CLINTON": 5,
    "SEA": 7,
    "P52": 7,  # Pier 52 / Colman Dock
    "COL": 7,
    "EDM": 8,
    "FAU": 9,
    "FRH": 10,
    "FH": 10,
    "COUP": 11,
    "KEY": 11,  # Keystone, Coupeville's historical name
    "KIN": 12,
    "KING": 12,
    "LOP": 13,
    "MUK": 14,
    "ORC": 15,
    "PD": 16,
    "PTD": 16,
    "PT": 17,
    "SHA": 18,
    "SHAW": 18,
    "SW": 20,
    "SOUTH": 20,
    "TAH": 21,
    "VASH": 22,
}

_CANCEL_RE = re.compile(r"cancel", re.IGNORECASE)
_SAILING_RE = re.compile(r"\b(\d{3,4})\s+([A-Z0-9]{2,7})\s*[>/]\s*([A-Z0-9]{2,7})\b")


@dataclass(frozen=True)
class ParsedSailing:
    hhmm: str  # zero-padded 24h "04:05"
    dep_code: str
    arr_code: str
    dep_id: int
    arr_id: int


def parse_cancelled_sailings(
    text: str | None, body: str | None = None
) -> tuple[list[ParsedSailing], bool]:
    """Returns (sailings, parsed_cleanly).

    parsed_cleanly is True only when the prose mentions cancellation AND
    every TIME CODE>CODE mention resolved to known terminals - partial
    resolution is a miss so the fallback can cover what we couldn't read.
    Prose that never mentions cancelling parses to ([], True): there is
    nothing to extract and nothing was missed.

    The prose is RouteAlertText followed by the BulletinText body. Until
    2026-09-03 only the one-liner was read, so a bulletin whose one-liner
    repeats its title and whose body says "the 5:30 p.m. sailing is
    cancelled" parsed as "nothing to extract" - clean, silent, no caveat
    line. With the body in, that case fails closed into the honest
    fallback ("we couldn't determine the specific sailings").
    """
    prose = "\n".join(part for part in (text, body) if part)
    if not prose or not _CANCEL_RE.search(prose):
        return [], True

    mentions = _SAILING_RE.findall(prose)
    if not mentions:
        return [], False  # cancellation prose we couldn't decode

    out: list[ParsedSailing] = []
    for raw_time, dep_code, arr_code in mentions:
        hhmm = raw_time.zfill(4)
        hh, mm = int(hhmm[:2]), int(hhmm[2:])
        dep_id = TERMINAL_CODES.get(dep_code)
        arr_id = TERMINAL_CODES.get(arr_code)
        if dep_id is None or arr_id is None or hh > 23 or mm > 59:
            return [], False
        out.append(
            ParsedSailing(
                hhmm=f"{hh:02d}:{mm:02d}",
                dep_code=dep_code,
                arr_code=arr_code,
                dep_id=dep_id,
                arr_id=arr_id,
            )
        )
    return out, True
