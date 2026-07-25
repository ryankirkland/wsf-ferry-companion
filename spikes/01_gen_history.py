"""Generate ~5M synthetic sailings (2002-2026) as year-partitioned Parquet.

Runs fully offline. Distribution is matched to the real exploration findings
(api-exploration-wsdot-ferries): median delay ~4 min with a heavy right tail,
~2% cancellations concentrated on the tidal route, 10 routes with different
daily sailing counts. Deterministic (seeded) so spike runs are reproducible.

Run: uv run --with pyarrow python spikes/01_gen_history.py
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta

import pyarrow as pa
import pyarrow.parquet as pq

from _config import DATA_DIR

SEED = 47
YEARS = range(2002, 2027)
SCALE = 1.55  # lifts total to ~5.1M rows, the volume the ADR gates reference

# route_id, abbrev, sailings/day, vessels, tidal-cancel-prone
ROUTES = [
    (5, "sea-bi", 46, ["Tacoma", "Wenatchee", "Puyallup"], False),
    (3, "sea-br", 30, ["Chimacum", "Kaleetan", "Walla Walla"], False),
    (6, "ed-king", 46, ["Spokane", "Puyallup", "Chelan"], False),
    (7, "muk-cl", 60, ["Suquamish", "Tokitae", "Kittitas"], False),
    (8, "pt-key", 30, ["Kennewick", "Salish"], True),
    (9, "ana-sj", 34, ["Yakima", "Samish", "Chelan", "Tillikum"], False),
    (13, "f-s", 22, ["Cathlamet", "Kitsap"], False),
    (14, "f-v-s", 40, ["Issaquah", "Cathlamet", "Kitsap"], False),
    (15, "s-v", 18, ["Sealth", "Kittitas"], False),
    (1, "pd-tal", 38, ["Chetzemoka"], False),
]
TERMINAL_PAIRS = {5: (7, 3), 3: (7, 4), 6: (8, 12), 7: (14, 5), 8: (17, 11),
                  9: (1, 10), 13: (9, 20), 14: (9, 22), 15: (20, 22), 1: (16, 21)}

SCHEMA = pa.schema([
    ("route_id", pa.int16()),
    ("route_abbrev", pa.string()),
    ("vessel_name", pa.string()),
    ("service_date", pa.date32()),
    ("departing_terminal_id", pa.int16()),
    ("arriving_terminal_id", pa.int16()),
    ("scheduled_depart", pa.timestamp("ms")),
    ("actual_depart", pa.timestamp("ms")),
    ("delay_min", pa.float32()),
    ("cancelled", pa.bool_()),
])


def delay_minutes(rng: random.Random) -> float:
    """Median ~4, p75 ~15-20, rare 60-180 tail - matches observed skew."""
    base = rng.lognormvariate(1.45, 1.05)
    if rng.random() < 0.015:
        base += rng.uniform(45, 170)
    return round(min(base - rng.uniform(0, 3.5), 200), 1)  # small chance of early departures


def gen_year(year: int, rng: random.Random):
    cols = {name: [] for name in SCHEMA.names}
    day = date(year, 1, 1)
    end = date(year, 12, 31)
    while day <= end:
        for route_id, abbrev, base_per_day, vessels, tidal in ROUTES:
            per_day = int(base_per_day * SCALE)
            dep_t, arr_t = TERMINAL_PAIRS[route_id]
            for i in range(per_day):
                minute_of_day = 290 + int(i * (1150 / per_day)) + rng.randint(-4, 4)
                sched = datetime(day.year, day.month, day.day, minute_of_day // 60, minute_of_day % 60)
                cancel_p = 0.045 if (tidal and day.month in (6, 7, 8, 12, 1)) else 0.008
                cancelled = rng.random() < cancel_p
                d = None if cancelled else delay_minutes(rng)
                cols["route_id"].append(route_id)
                cols["route_abbrev"].append(abbrev)
                cols["vessel_name"].append(vessels[i % len(vessels)])
                cols["service_date"].append(day)
                cols["departing_terminal_id"].append(dep_t if i % 2 == 0 else arr_t)
                cols["arriving_terminal_id"].append(arr_t if i % 2 == 0 else dep_t)
                cols["scheduled_depart"].append(sched)
                cols["actual_depart"].append(None if cancelled else sched + timedelta(minutes=d))
                cols["delay_min"].append(None if cancelled else d)
                cols["cancelled"].append(cancelled)
        day += timedelta(days=1)
    return pa.table(cols, schema=SCHEMA)


def main():
    out_root = DATA_DIR / "history"
    total_rows = 0
    total_bytes = 0
    for year in YEARS:
        rng = random.Random(SEED * 10000 + year)
        table = gen_year(year, rng)
        part_dir = out_root / f"year={year}"
        part_dir.mkdir(parents=True, exist_ok=True)
        path = part_dir / "part-0.parquet"
        pq.write_table(table, path, compression="zstd")
        total_rows += table.num_rows
        total_bytes += path.stat().st_size
        print(f"{year}: {table.num_rows:,} rows  {path.stat().st_size/1e6:.1f} MB")
    print(f"\nTOTAL: {total_rows:,} rows, {total_bytes/1e6:.1f} MB zstd parquet -> {out_root}")


if __name__ == "__main__":
    main()
