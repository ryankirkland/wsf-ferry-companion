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
  convention), winning pollutant recorded. Endpoint since 2026-10-24:
  `/aq/observation/current/ziplatlong/` (the lat/long service it
  replaces was retired 2026-10-01). It ignores `distance` (fixed 50-mile
  lookup) and takes the closest monitor per pollutant, so one answer can
  mix sites - Anacortes' PM10 came from Abbotsford, B.C. at the probe.
  `area` in the contract is our pinned area name (AirNow's came back null
  for 4 of 6 areas); `site` names the monitor that set the AQI.
- Publishes `/data/weather.json` v1 (ADR-0005): per terminal
  `as_of` (NWS updateTime - forecaster publish time, never our fetch
  time), `hours` (156 compact rows: epoch_ms, temp_f, icon token,
  pop_pct, wind_mph, wind_dir, short text), `aqi`, or `unavailable`
  with a reason. `aqi` = {aqi, category, pollutant, area, site,
  observed_date, observed_hour, observed_at}; `observed_at` (ISO UTC,
  added 2026-10-24) is computed from AirNow's local date, hour and zone
  label, and an entry without one is never treated as current. ~175 KB raw, small gzipped, 5-minute edge cache.
- Failure honesty: a cell/area that fails after one retry keeps its
  last PUBLISHED entry - old `as_of` rides along so clients can label
  staleness - and emits LastGoodFallbacks + a log line. **AQI has an age
  cap**: a reading older than 3 h, or stamped more than 1 h in the
  future, is withdrawn (published as `aqi: null`), whether it came fresh
  from AirNow or from last-good. Every AirNow-covered terminal lands in
  exactly one bucket per run - current fresh reading (uncounted),
  current last-good (`LastGoodFallbacks`), or no current reading
  (`AqiUnavailable`) - so an outage keeps counting for its whole length. Forecasts keep the label-it-don't-hide rule;
  AQI cannot, because the chip has no room for an age and "current air
  quality" from yesterday is wrong, not merely old. Added after the
  2026-10-01 AirNow retirement served one 3 a.m. reading as current for
  23 days. Icons map from
  the NWS icon URL's path segment (their /icons endpoint is deprecated;
  the frontend owns the artwork); unknown conditions degrade to a
  generic bucket, never break.
- Alarms: `weather-not-published` (2 h of silence = dead pipeline;
  missing data breaches) and `weather-degraded`, which asks whether the
  upstream integration is DEAD - >400 fallbacks plus AQI-unavailable
  terminal-runs in 12 h (metric math since 2026-10-24, so the age cap cannot
  make an outage longer than 3 h look like recovery), i.e. no fresh
  reading for half a day (expired key, moved endpoint, silently broken
  parse), not merely flaky. **Retuned 2026-08-22**: the first version
  summed >30 over 3 h, which real flaky days clear routinely (sums of
  23-73 that day), so it oscillated across the threshold and, with
  `ok_actions` also wired, sent eight emails in one afternoon for a
  condition that never changed and that no human could act on. AirNow
  503/502 stretches are the fallback's JOB, not an incident. The metric
  stays (it is the honesty meter - how often riders see stale AQI);
  only the paging question changed.

## Frontend (W1)

- `lib/data/weather.ts`: TTL-cached fetch; `hourFor(terminal, ms)` owns
  the horizon rule (nothing rendered outside NWS's published hours);
  `aqiTone` maps EPA thresholds (theirs, not ours). `currentAqi(t,
  nowMs)` returns a terminal's AQI only while it is under
  `AQI_MAX_AGE_MS` (3 h, mirroring the poller) and not over 1 h in the
  future, and only for a strict ISO-UTC stamp - the guard for a pipeline
  that stopped publishing and left its last file in place. Strict format
  because `Date.parse` accepts junk (V8 reads "%%ISO-40%%" as 2040).
- `lib/weather-glyphs.ts`: the ONE source of glyph artwork, consumed by
  the React `WeatherIcon` (trip pages) and the DOM-built map chips.
  Flat filled shapes on a fixed palette (amber sun, gray cloud, blue
  rain), not line drawings - the owner's 2026-08-20 call after the
  stroked set proved "very hard to decipher" at chip sizes, and flat
  color is the map's native language. Sized for glanceability after two
  owner passes (+30% then +50%, 2026-08-20): trip-page icons 36 px at
  1.68rem text, AQI chips 1.47rem, map chips 26 px icons + 21 px temps
  (2026-08-30: trip icons 26 px / chips ~1.55rem - the h1 placement
  below wants subordination to the names, not parity).
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

- `components/weather/TerminalWeather.tsx` (was WeatherStrip): the trip
  page's weather is worn by the h1 itself - the server-rendered shell
  leaves an empty slot span beside each terminal name and this client
  component portals a compact chip (icon, temp, rain >=15%, AQI pill)
  into it, condition/wind detail in the title. Owner's 2026-08-30 call:
  the standalone strip repeated the names the h1 already said, and the
  page reads cleaner with weather on the names. Honesty survives the
  move: outside the horizon a slot stays empty, per-end unavailability
  is silent absence (the old "no forecast" text died with the section),
  and a stale as_of still prints out loud as a note where the strip sat.
  2026-09-13 layout: the h1 is a two-column grid, one per end - the
  names (and the arrow, which rides in the departure cell) share ONE
  line at every width, and each chip sits in the row UNDER its own name,
  so both terminals' AQI read side by side. The chip is caption-sized
  (1rem, 22 px icon, 0.72rem AQI pill) and its slot is
  `contain: inline-size`, so the name sizes the column and a long AQI
  category wraps its pill under the temperature instead of pushing the
  arrow off the name. The stale note now says "Weather is from a
  forecast published {soundStamp} and may be out of date" - the old
  "forecast from 11:26 AM" printed the clock only, so a days-old
  forecast read as this morning's (owner: "What is this?").

## Status

- 2026-10-24: AirNow migration. The lat/long observation service was
  retired 2026-10-01 (announced June 2026); every AQI fetch got HTTP 410
  for 23 days while the last-good fallback kept serving a single 3 a.m.
  Oct 1 reading with no age on the chip. The degraded alarm fired once
  and, having no ok_actions and never recovering, stayed silent after.
  Fix: replacement endpoint + new field names (live probe with our key,
  samples in api-exploration-weather/samples/airnow-2026-10-24/), a 3 h
  AQI age cap in the poller and the client, `AqiUnavailable` folded into
  the degraded alarm, and a test that pins the request URL (every other test
  stubs the HTTP layer, so a retired endpoint could never fail CI).
- 2026-09-13: h1 chips restacked under the names (one-line title, both
  AQIs side by side), stale-forecast copy made explicit, dev fixture
  filled with per-area AQI for every covered terminal to match
  production (it had AQI on 3 terminals, so dev showed one end only).
- 2026-08-30: trip-page weather moved out of its own section and onto
  the h1's terminal names (portaled chips; stale note stays inline).
  Owner call for a cleaner page.

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
