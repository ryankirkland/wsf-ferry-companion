# F6: Per-terminal weather

Living reference for F6. Updated whenever the feature changes.
Evidence base: [api-exploration-weather/weather.md](../../api-exploration-weather/weather.md).

## Goal

Ryan's words at the acceptance walk (2026-08-19): "sometimes it could be
overcast in Port Orchard but dumping rain in downtown Seattle where I'm
def gonna have to walk to a bus." Weather at each terminal, for planning
the day - including the air, in smoke season.

## Requirements (locked by Q&A, 2026-08-19)

- Surfaces: trip pair pages (both terminals) + map terminal markers,
  ambient included.
- Time frame: hybrid - markers show now; trip pages show the forecast
  around the sailing being viewed.
- Fields: condition + icon, temperature, rain chance, wind on trip
  pages; icon + temperature on markers. AQI always visible on trip
  pages (EPA category colors).
- Display only: no derived warnings - we have not measured what wind
  correlates with WSF disruptions, and unearned warnings would break
  the honesty rules.
- Honest absence: dates past NWS's ~6.5-day hourly horizon show
  nothing; Sidney B.C. (outside US coverage for both sources) shows a
  labeled gap.

## Backend (D1)

`wsf-prod-weather-poller` (services/weather), rate(30 minutes):

- NWS hourly forecasts for the 19 distinct grid cells covering 20
  terminals; the terminal->cell resolution is PINNED in the committed
  gridcells.json (grid assignment is rounding-sensitive - see the
  exploration doc) and re-derived only by rerunning
  tools/weather/resolve-gridcells.py.
- AirNow current observations for 6 reporting areas (one representative
  terminal each); overall AQI = worst reporting parameter (EPA
  convention), winning pollutant recorded.
- Publishes `/data/weather.json` v1 (ADR-0005): per terminal
  `as_of` (NWS updateTime - forecaster publish time, never our fetch
  time), `hours` (156 compact rows: epoch_ms, temp_f, icon token,
  pop_pct, wind_mph, wind_dir, short text), `aqi`, or `unavailable`
  with a reason. ~175 KB raw, small gzipped, 5-minute edge cache.
- Failure honesty: a cell/area that fails after one retry keeps its
  last PUBLISHED entry - old `as_of` rides along so clients can label
  staleness - and emits LastGoodFallbacks + a log line. Icons map from
  the NWS icon URL's path segment (their /icons endpoint is deprecated;
  the frontend owns the artwork); unknown conditions degrade to a
  generic bucket, never break.
- Alarms: `weather-not-published` (2 h of silence = dead pipeline;
  missing data breaches) and `weather-degraded` (sustained last-good
  leaning; one-off NWS 503 stretches deliberately stay under it).

## Frontend (W1)

Planned: Paper Sound icon set keyed by token; trip-page weather strip
(both terminals, sailing-time row selected from `hours`); marker chips
(icon + temp) on map + ambient; AQI chip with EPA category colors.

## Status

- 2026-08-19: explorations (NWS + AirNow) committed; gridcells pinned;
  poller + tests + infra written; live-fire local run against real
  upstreams: 20/21 covered, 0 errors, Seattle 72F Mostly Clear AQI 54
  Moderate, 156 h/terminal. W1 frontend next.
