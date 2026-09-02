# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.27"]
# ///
"""Resolve every WSF terminal to its NWS forecast grid cell, once.

Grid assignment is rounding-sensitive (Anacortes flips cells between 3-
and 4-decimal coordinates - see api-exploration-weather/weather.md), so
the poller must never re-derive it: this script pins the resolution and
commits the result as gridcells.json, the weather poller's dim. Re-run
only if WSF moves a terminal or NWS re-grids (their changelog announces
it); the diff is the review.

Every resolved cell is verified to actually SERVE an hourly forecast
(HTTP 200 with periods) before it is written - NWS types all terminal
points as marine, which forecasts fine, but genuinely offshore cells
404, and that must fail HERE, not in production.

AirNow reporting areas ride along: one representative terminal per area
keeps the poller at 6 AirNow calls instead of 21. Requires
AIRNOW_API_KEY in the environment (it lives in .env).

Usage:
  uv run tools/weather/resolve-gridcells.py
"""

import json
import os
import time
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parents[2] / "services/weather/src/wsf_weather/gridcells.json"
UA = {"User-Agent": "soundferries.com weather (contact: via site)"}
TERMINALS_URL = "https://soundferries.com/data/terminals.json"
AIRNOW_DISTANCE_MI = 30


def main() -> None:
    airnow_key = os.environ.get("AIRNOW_API_KEY")
    if not airnow_key:
        raise SystemExit("AIRNOW_API_KEY not set (it lives in .env)")

    terminals = httpx.get(TERMINALS_URL, timeout=30).json()["terminals"]
    print(f"{len(terminals)} terminals")

    rows = []
    for t in sorted(terminals, key=lambda t: t["id"]):
        # 4-decimal pin: the exact string NWS resolved, recorded forever.
        lat, lon = round(t["lat"], 4), round(t["lon"], 4)
        entry = {
            "terminal_id": t["id"],
            "name": t["name"],
            "lat": lat,
            "lon": lon,
            "grid": None,
            "airnow_area": None,
        }

        points = httpx.get(f"https://api.weather.gov/points/{lat},{lon}", headers=UA, timeout=30)
        if points.status_code == 200:
            props = points.json()["properties"]
            grid = {
                "office": props["gridId"],
                "x": props["gridX"],
                "y": props["gridY"],
            }
            # The cell must serve an hourly forecast TODAY or it does not ship.
            fc = httpx.get(
                f"https://api.weather.gov/gridpoints/{grid['office']}/{grid['x']},{grid['y']}/forecast/hourly",
                headers=UA,
                timeout=30,
            )
            body = fc.json() if fc.status_code == 200 else {}
            periods = body.get("properties", {}).get("periods", [])
            if periods:
                entry["grid"] = grid
                cell = f"{grid['office']}/{grid['x']},{grid['y']}"
                print(f"  {t['name']:22} {cell}  {len(periods)} hourly periods")
            else:
                print(f"  {t['name']:22} forecast {fc.status_code} - SHIPPING AS UNCOVERED")
        else:
            print(
                f"  {t['name']:22} points {points.status_code} - uncovered "
                "(expected for Sidney B.C.)"
            )

        obs = httpx.get(
            "https://www.airnowapi.org/aq/observation/latLong/current/",
            params={
                "format": "application/json",
                "latitude": lat,
                "longitude": lon,
                "distance": AIRNOW_DISTANCE_MI,
                "API_KEY": airnow_key,
            },
            timeout=30,
        )
        if obs.status_code == 200 and obs.json():
            entry["airnow_area"] = obs.json()[0]["ReportingArea"]

        rows.append(entry)
        time.sleep(0.4)

    # One representative terminal per AirNow area (lowest terminal id wins,
    # deterministically) - the poller queries areas, not terminals.
    reps: dict[str, int] = {}
    for r in rows:
        if r["airnow_area"] and r["airnow_area"] not in reps:
            reps[r["airnow_area"]] = r["terminal_id"]

    doc = {
        "resolved_at": time.strftime("%Y-%m-%d"),
        "terminals": rows,
        "airnow_area_representatives": reps,
    }
    OUT.write_text(json.dumps(doc, indent=1) + "\n")
    covered = sum(1 for r in rows if r["grid"])
    print(f"\nwrote {OUT.name}: {covered}/{len(rows)} NWS-covered, {len(reps)} AirNow areas")


if __name__ == "__main__":
    main()
