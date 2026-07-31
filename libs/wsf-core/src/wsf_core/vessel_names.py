"""Display names for vessels as the history feed reports them.

vesselhistory answers with a compacted name - "WallaWalla", never "Walla
Walla" - which is the same quirk that makes the URL path drop spaces. The
Parquet keeps whatever the feed said (it is ground truth and must stay
re-derivable), so the repair happens once, here, on the way to a page.

Resolution order:
1. The live fleet dim, matched with spaces removed. That covers every boat
   still sailing and needs no hand-maintained list.
2. A small curated map for boats retired before the dim existed, whose
   feed name is genuinely shorter than their name.
3. The feed name unchanged - a new boat renders as reported rather than
   disappearing behind a lookup miss.
"""

# Verified during the M4 D1 retired-vessel probe: the feed answers to
# "Evergreen" for MV Evergreen State and returns no rows for the full name.
RETIRED_VESSEL_NAMES: dict[str, str] = {"Evergreen": "Evergreen State"}


def compact(name: str) -> str:
    return name.replace(" ", "").casefold()


def build_display_map(fleet_names) -> dict[str, str]:
    """compacted feed name -> the name a rider would recognize."""
    display = {compact(n): n for n in fleet_names}
    for feed_name, proper in RETIRED_VESSEL_NAMES.items():
        display.setdefault(compact(feed_name), proper)
    return display


def display_name(feed_name: str, display_map: dict[str, str]) -> str:
    return display_map.get(compact(feed_name), feed_name)
