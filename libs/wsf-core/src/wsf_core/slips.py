"""Vesselhistory slip-name -> TerminalID alias map (M4 D2, ADR-0006-era
quirks discipline).

Curated from the COMPLETE backfill vocabulary: a distinct-slips scan over
all 4,058,477 raw rows (2002-2026, 30 vessels, 2026-07-30) found exactly
22 values - every one is mapped or deliberately quarantined here. History
uses slip names, never TerminalNames ("Colman" = Seattle; 0% direct match,
n=148 in exploration), so this table is the only join path.

Notes:
- "Keystone" is Coupeville's pre-2010 name -> 11.
- "Colman PO" is the Seattle passenger-only dock -> 7 (same terminal for
  pair statistics).
- "Sidney B. C." (route ran 2002-2019) has no current terminal row; 19 is
  its historical WSF id, carried as a synthetic dim like Eagle Harbor 122.
- None/null slips (~2.9% of rows, concentrated 2020-2023) cannot join to
  a pair and quarantine under reason "null_slip".
"""

SIDNEY_TERMINAL_ID = 19

SLIP_TERMINALS: dict[str, int] = {
    "Anacortes": 1,
    "Bainbridge": 3,
    "Bremerton": 4,
    "Clinton": 5,
    "Colman": 7,
    "Colman PO": 7,
    "Edmonds": 8,
    "Fauntleroy": 9,
    "Friday Harbor": 10,
    "Keystone": 11,
    "Kingston": 12,
    "Lopez": 13,
    "Mukilteo": 14,
    "Orcas": 15,
    "Pt. Defiance": 16,
    "Port Townsend": 17,
    "Shaw": 18,
    "Sidney B. C.": SIDNEY_TERMINAL_ID,
    "Southworth": 20,
    "Tahlequah": 21,
    "Vashon": 22,
    "Coupeville": 11,  # defensive: modern name, should it ever appear
}

# Names for terminals that no longer exist in the live dims.
RETIRED_TERMINAL_NAMES: dict[int, str] = {
    SIDNEY_TERMINAL_ID: "Sidney B.C.",
}
