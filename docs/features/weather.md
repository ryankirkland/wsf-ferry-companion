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

- `lib/data/weather.ts`: TTL-cached fetch; `hourFor(terminal, ms)` owns
  the horizon rule (nothing rendered outside NWS's published hours);
  `aqiTone` maps EPA thresholds (theirs, not ours).
- `lib/weather-glyphs.ts`: the ONE source of glyph artwork, consumed by
  the React `WeatherIcon` (trip pages) and the DOM-built map chips.
  Flat filled shapes on a fixed palette (amber sun, gray cloud, blue
  rain), not line drawings - the owner's 2026-08-20 call after the
  stroked set proved "very hard to decipher" at chip sizes, and flat
  color is the map's native language. Sized for glanceability after two
  owner passes (+30% then +50%, 2026-08-20): strip icons 36 px at
  1.68rem text, AQI chips 1.47rem, map chips 26 px icons + 21 px temps.
  The staggered Fauntleroy/Vashon/Southworth markers carry name AND chip
  at every zoom - a first cut hid their chips below the declutter zoom,
  which on a phone's default framing meant no weather at all (owner
  caught it same day); hanging Southworth below-left and Vashon
  below-right freed the chip rows instead. See realtime-map.md for the
  stagger system.
- Trip pages: `WeatherStrip` under the answer line - both terminals at
  the VIEWED sailing's hour (today with nothing left shows now), short
  text, rain chance >=15%, wind >=12 mph, AQI chip always (category
  name always rides the color). A stale forecast (>12 h) says so.
- Map + ambient: icon + temperature chips on terminal labels
  (controller.syncWeather, 10-min refresh), following the labels' own
  declutter rules; missing weather removes chips, never fakes them.

## Status

- 2026-08-20: glyphs redrawn flat + colorful, everything ~30% bigger
  (PR #102) - owner acceptance feedback; verified live on the deployed
  pair pages and map.
- 2026-08-19 (late): W1 shipped - strip, chips, glyph set, fixture
  template, 5 unit + 3 e2e specs; every poll banked to raw/weather/ for
  the future weather-vs-delay join (owner's call). AirNow outage at
  first publish rode the last-good design exactly as intended.
- 2026-08-19: explorations (NWS + AirNow) committed; gridcells pinned;
  poller + tests + infra written; live-fire local run against real
  upstreams: 20/21 covered, 0 errors, Seattle 72F Mostly Clear AQI 54
  Moderate, 156 h/terminal. W1 frontend next.
