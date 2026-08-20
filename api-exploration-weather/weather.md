# National Weather Service API (api.weather.gov) - Data Source Exploration

**Explored:** 2026-08-19 · Purpose: per-terminal weather for Ferry Sound trip planning ("overcast in Port Orchard, dumping rain in downtown Seattle") · All probes real HTTP (curl/urllib, ferrysound.com User-Agent). Raw captures were working artifacts, not committed; every claim below carries its evidence inline.

## Verdict up front

NWS fits. The 20 resolvable WSF terminals occupy **18 distinct forecast grid cells**, and at a single observed hour those cells disagreed by up to 13 F and 5 mph wind - the cross-Sound differentiation Ryan wants is real in the data, not just in the marketing. Free, public domain, no key, forecaster-curated prose (`shortForecast`), 6.5-day hourly horizon. Two structural caveats: **Sidney B.C. is outside NWS coverage (404)** and needs a labeled gap or a second source, and the API has a community-known history of intermittent 5xx flakiness - the snapshot pattern (ADR-0005) absorbs that by design.

## Connection

- Base URL: `https://api.weather.gov`
- Style: REST, GeoJSON-flavored JSON-LD (`application/geo+json` default; `application/ld+json` available). GET only. HTTP/2. CORS open (`access-control-allow-origin: *`).
- Auth: none. Docs: "A User Agent is required to identify your application... include contact information (website or email)... **This will be replaced with an API key in the future.**" Suggested format `User-Agent: (myweatherapp.com, contact@myweatherapp.com)`. Probed 2026-08-19: a request with **no** User-Agent currently returns 200 - enforcement is lax today, but send it always; the API-key transition is pre-announced.
- Rate limit (official docs, fetched 2026-08-19): "reasonable rate limits... The rate limit is not public information, but allows a generous amount for typical use. If the rate limit is exceeded a request will return with an error, and may be retried after the limit clears (typically within 5 seconds)."
- License/cost: US Government open data, "free to use for any purpose", no fees.
- Ops contact per docs: operational issues to nco.ops@noaa.gov; changes pre-announced via Service Change Notices and a `Feature-Flags` request header mechanism (responses `Vary: Accept,Feature-Flags,Accept-Language`).

## The two-step flow (verified)

### Step 1: `GET /points/{lat},{lon}` - coordinate -> grid cell (static mapping)

```
GET https://api.weather.gov/points/47.602,-122.338      (Seattle Colman Dock)
HTTP/2 200, content-type: application/geo+json, 3,921 B
cache-control: public, max-age=86400, s-maxage=120
```

Key properties (Seattle):

```json
"cwa": "SEW", "type": "land",
"gridId": "SEW", "gridX": 124, "gridY": 68,
"forecast":        "https://api.weather.gov/gridpoints/SEW/124,68/forecast",
"forecastHourly":  "https://api.weather.gov/gridpoints/SEW/124,68/forecast/hourly",
"forecastGridData":"https://api.weather.gov/gridpoints/SEW/124,68",
"observationStations": ".../gridpoints/SEW/124,68/stations",
"relativeLocation": {"city": "Seattle", "state": "WA", ...},
"timeZone": "America/Los_Angeles"
```

The mapping from coordinate to (gridId, gridX, gridY) is effectively static (NWS 2.5 km NDFD grid). Resolve once, persist as a dim, refresh rarely (see Gotchas: grids can very occasionally be renumbered when a WFO's grid is redefined).

### Step 2: `GET /gridpoints/{wfo}/{x},{y}/forecast/hourly` - the product

```
HTTP/2 200, ~163 KB per cell
last-modified: Wed, 19 Aug 2026 21:59:58 GMT
cache-control: public, max-age=1097, s-maxage=3600      (max-age counts down toward expires; a later fetch showed max-age=1688)
```

Body shape (`properties`):

- `updateTime` - when the forecaster grid behind this product was published. **Observed identical across all 18 cells: `2026-08-19T18:26:45+00:00`** - it is a CWA-wide publish stamp, ~4.8 h old at observation time. This is the honest "as-of" for the data.
- `generatedAt` - render time of this API response (churns per request/cache fill; not a data-freshness signal).
- `units`: "us"; `periods[]`: **156 hourly periods = 6.5-day horizon** (12 h endpoint: 14 half-day periods = 7 days).

Per hourly period (all fields, from sample):

```json
{
  "number": 1, "name": "", "isDaytime": true,
  "startTime": "2026-08-19T15:00:00-07:00", "endTime": "2026-08-19T16:00:00-07:00",
  "temperature": 70, "temperatureUnit": "F", "temperatureTrend": "",
  "probabilityOfPrecipitation": {"unitCode": "wmoUnit:percent", "value": 0},
  "dewpoint": {"unitCode": "wmoUnit:degC", "value": 15},
  "relativeHumidity": {"unitCode": "wmoUnit:percent", "value": 68},
  "windSpeed": "3 mph", "windDirection": "NW",
  "shortForecast": "Mostly Sunny",
  "icon": "https://api.weather.gov/icons/land/day/sct?size=small",
  "detailedForecast": ""
}
```

Every field the /data contract needs is present: temp, PoP, wind, prose, icon. PoP was never null in the sample (n=624 periods across 4 terminals; values 0-57).

## Grid resolution: all terminals from ferrysound.com/data/terminals.json (measured 2026-08-19)

`terminals.json` carries 21 rows: 20 real terminals + synthetic Eagle Harbor yard (id 122). Coordinates rounded to 4 decimals (API requirement, see Gotchas), resolved one call each, 0.7 s spacing:

| id | terminal | lat,lon | grid cell | point type |
|---:|---|---|---|---|
| 1 | Anacortes | 48.5074,-122.6770 | SEW/122,113 | marine |
| 3 | Bainbridge Island | 47.6223,-122.5096 | SEW/119,70 | marine |
| 4 | Bremerton | 47.5618,-122.6241 | SEW/115,68 | marine |
| 5 | Clinton | 47.9754,-122.3496 | SEW/128,85 | marine |
| 7 | Seattle | 47.6025,-122.3405 | SEW/124,68 | marine |
| 8 | Edmonds | 47.8134,-122.3854 | SEW/125,78 | marine |
| 9 | Fauntleroy | 47.5232,-122.3967 | SEW/122,65 | marine |
| 10 | Friday Harbor | 48.5358,-123.0138 | SEW/112,116 | marine |
| 11 | Coupeville | 48.1590,-122.6726 | SEW/119,96 | marine |
| 12 | Kingston | 47.7946,-122.4943 | SEW/121,78 | marine |
| 13 | Lopez Island | 48.5709,-122.8828 | SEW/117,117 | marine |
| 14 | Mukilteo | 47.9506,-122.2970 | SEW/129,84 | marine |
| 15 | Orcas Island | 48.5973,-122.9435 | SEW/115,118 | marine |
| 16 | Point Defiance | 47.3065,-122.5141 | SEW/116,55 | marine |
| 17 | Port Townsend | 48.1108,-122.7590 | SEW/116,94 | marine |
| 18 | Shaw Island | 48.5848,-122.9296 | SEW/115,118 | marine |
| 19 | Sidney B.C. | 48.6431,-123.3967 | **404 InvalidPoint** | - |
| 20 | Southworth | 47.5131,-122.4957 | SEW/119,65 | marine |
| 21 | Tahlequah | 47.3320,-122.5078 | SEW/116,56 | marine |
| 22 | Vashon Island | 47.5110,-122.4636 | SEW/120,64 | marine |
| 122 | Eagle Harbor (synthetic) | 47.6205,-122.5145 | SEW/119,70 | marine |

- **Distinct grid cells: 18** (20 resolvable terminals; shared cells: Orcas + Shaw at SEW/115,118, Bainbridge + Eagle Harbor at SEW/119,70).
- All 18 cells live in one WFO (SEW, Seattle). All 21 points that resolve report `timeZone: America/Los_Angeles`.
- **All 18 cells verified serving hourly forecasts** - 18/18 HTTP 200 in a single pass (hourly-all-cells.json), no MarineForecastNotSupported among them despite every terminal point classifying as `type: marine` (docks sit over water; the type describes the point's polygon, not forecast availability).

### Differentiation evidence (same hour, same updateTime, 2026-08-19 ~16:00 PDT)

| cell | terminals | temp F | wind | shortForecast |
|---|---|---:|---|---|
| SEW/122,113 | Anacortes | 62 | 2 mph SW | Mostly Sunny |
| SEW/119,65 | Southworth | 64 | 3 mph NNE | Mostly Sunny |
| SEW/120,64 | Vashon | 65 | 3 mph N | Mostly Sunny |
| SEW/116,94 | Port Townsend | 67 | 6 mph NW | Sunny |
| SEW/124,68 | Seattle | 70 | 3 mph NW | Mostly Sunny |
| SEW/125,78 | Edmonds | 74 | 5 mph NNW | Mostly Sunny |
| SEW/128,85 | Clinton | 75 | 5 mph NNW | Mostly Sunny |
| SEW/116,56 | Tahlequah | 75 | 2 mph E | Mostly Sunny |

13 F spread and independent wind/sky values across the Sound on a bland sunny day - on a convergence-zone day the contrast will be far stronger. The forecast week in the same sample carried `rain_showers,60` and `tsra,60` tokens at some terminals and not others.

## Update cadence (observed + interpreted)

- `updateTime` (data freshness): one value CWA-wide (`18:26:45Z` on every one of 18 cells, and unchanged on a re-check ~50 min later). WFOs publish forecast packages a few times a day plus event-driven amendments - observed age at probe time was ~4.8 h. **The underlying data does not change hourly**; polling faster than ~15-30 min buys nothing.
- `last-modified` on the rendered hourly product: `21:59:58Z` while updateTime was `18:26:45Z` - the rendering rolls the leading period forward each hour even without a new forecaster publish.
- CDN caching: `s-maxage=3600` on forecasts. Observed consequence: two fetches of the same cell 20 minutes apart returned first periods an hour apart (15:00 vs 16:00 local) - one was an hour-old CDN hit. A consumer's effective staleness is updateTime age + up to 1 h of CDN. `cache-control: max-age` is dynamic (1097 then 1688 observed), counting toward the `expires` stamp.
- `/points` responses: `max-age=86400, s-maxage=120` - and the mapping itself is static, so cache it as a dim, not per-request.

## Failure surface (each probed 2026-08-19)

- No User-Agent -> **200 with full data today** (historically 403; docs still say required and pre-announce an API-key future - always send it).
- Point in Canada (49.5,-123.0 and Sidney B.C. 48.6431,-123.3967) -> **404** RFC-7807 problem+json: `type: .../problems/InvalidPoint`, "Unable to provide data for requested point".
- Coordinates with >4 decimal places -> **301** `AdjustPointPrecision` with corrected `location: /points/47.6023,-122.3381`. Bare curl/urllib without redirect-following sees a body, not data. Truncate to 4 decimals client-side.
- Garbage lat (`points/garbage,-122`) -> **404** with `parameterErrors: [{parameter: "path.latitude", message: "String value found, but a number is required"}]`.
- Far-offshore point (47.0,-125.5) -> points resolves fine (SEW/19,61, type marine) but its forecastHourly link -> **404** `MarineForecastNotSupported`: "Forecasts for marine areas are not yet supported by this API." A resolving `/points` is NOT proof the forecast link works - verify per cell (done for all 18 terminal cells: all OK). Mid-Sound points (e.g. 47.585,-122.450 -> SEW/121,68) resolve as marine; their forecast links were not probed - re-verify before ever doing vessel-position weather.
- Rate limiting -> not observed in ~50 spaced calls; documented as error-then-retry (~5 s).
- 5xx reputation: the API's own changelog admits the history - "7 Nov 2023: The gridpoints endpoint no longer return a 503 error for long periods with forecasts for ABQ, LSX, MAF, TSA, and UNR." Community reports of intermittent 503/500 on gridpoints (expired-grid condition where a WFO's NDFD publish lags) are long-standing. Treat any single fetch as best-effort; keep last-good.

## Gotchas (by severity)

- 🛑 **Sidney B.C. (terminal 19) is outside NWS coverage** - 404 InvalidPoint. The contract must carry an honest gap (null + reason) or a second source (Open-Meteo covers it keyless; Environment Canada is the authoritative source).
- 🛑 **`/icons` is formally deprecated** - `deprecated: true` on all three /icons operations in the live openapi.json. Do not hotlink `icon` URLs. Parse the token from the URL path (`land/{day|night}/{token}[,pop]`, and 12 h periods can carry split values like `tsra_sct,50/tsra_sct,30`) and map to the site's own icon set. Observed token vocabulary in sample: skc, few, sct, bkn, ovc, rain, rain_showers, tsra, tsra_sct (+ ,PoP suffixes).
- ⚠️ **Mixed units in one payload**: `temperature` in F (int) but `dewpoint` in `wmoUnit:degC` (float). Convert explicitly; never assume a family of fields shares units.
- ⚠️ **`windSpeed` is a display string, not a number**: hourly = `"3 mph"` (n=624, always single-value); 12 h periods = ranges like `"1 to 5 mph"`. Parse defensively if math is ever needed; store raw string plus parsed mph.
- ⚠️ **Grid-cell assignment is rounding-sensitive**: Anacortes at 48.507,-122.677 -> SEW/122,112 but at 48.5074,-122.6770 -> SEW/122,113 (adjacent row). Pin the exact coordinates used for resolution in the committed dim so the mapping is reproducible; both cells returned sane forecasts.
- ⚠️ **CDN staleness up to 1 h** (`s-maxage=3600`) on forecast responses - the poller can receive an hour-old render. Carry `updateTime` through to the published contract as the as-of; never present fetch time as data time.
- ⚠️ **`type: marine` on points is cosmetic for terminals but fatal offshore** - all 20 terminal points typed marine yet forecast fine; a genuinely offshore cell 404s (`MarineForecastNotSupported`). Never assume; verify each cell once.
- ℹ️ `updateTime` vs `generatedAt`: publish time vs render time. Freshness logic must use `updateTime`.
- ℹ️ >4-decimal coords 301-redirect; truncate to 4 decimals before calling.
- ℹ️ API key transition is pre-announced ("will be replaced with an API key in the future") - keep the HTTP client's auth injectable.
- ℹ️ `Vary: Feature-Flags` - NWS ships breaking changes behind request-header flags (e.g. `forecast_temperature_qv` changes temperature to a QuantitativeValue object) before defaulting them. Watch Service Change Notices; a schema drift alarm on the poller is warranted.
- ℹ️ Responses are JSON-LD with a large `@context` preamble - ignore it, read `properties`.
- ℹ️ Hourly payload is ~163 KB per cell; 18 cells ~= 2.9 MB per poll cycle. Fine for Lambda; don't ship it to clients - project to the compact snapshot.

## Alternatives (one paragraph each)

**Open-Meteo** (probed 2026-08-19, keyless 200): free for non-commercial use (10,000 calls/day), attribution required (CC-BY 4.0); commercial use requires a paid plan - Ferry Sound's portfolio posture fits the free tier today, but that is a license judgment to make consciously. Flat, clean JSON (verified: `hourly.time[]` + parallel arrays for `temperature_2m`, `precipitation_probability`, `wind_speed_10m`, `weather_code`), direct lat/lon (no grid indirection), global coverage **including Sidney B.C.**, model updates hourly-to-6-hourly (blends HRRR/ICON/GFS/ECMWF "best match"). Weaknesses vs NWS: pure model output with no forecaster curation, no prose `shortForecast` (WMO numeric weather codes only), and a third-party dependency with no government-backed continuity guarantee. Strong candidate for exactly one job: filling the Sidney B.C. hole, clearly labeled as a different source.

**OpenWeatherMap**: requires an API key and quota management (One Call 3.0: 1,000 calls/day free, then pay-per-call; card on file to activate). Proprietary model blend, ~10-min refresh claims, global coverage including Sidney. Data license on the free tier is CC-BY-SA (share-alike - viral for derived published data, worse than both alternatives). No forecaster prose comparable to NWS shortForecast quality for US coastal zones, and no particular marine/convergence-zone advantage over the NWS forecast actually written by the Seattle WFO. Adds key custody, quota alarms, and billing risk for no capability the other two lack. Not recommended.

## Integration sketch (fits ADR-0005 + existing poller patterns)

**Bootstrap (one-time + rare refresh):** a small resolver script (or a slow-path branch in the poller) reads the committed terminal dim, truncates coordinates to 4 decimals, calls `/points`, and commits `terminal_id -> {gridId, gridX, gridY}` as a checked-in dim with the resolution date and the exact coords used. It also verifies each cell's forecastHourly returns 200 (the MarineForecastNotSupported guard). Re-run on terminals.json change or quarterly; alarm if a mapping changes.

**Poller Lambda `weather-poller`** on EventBridge `rate(30 minutes)`:
- Fetches forecastHourly for the **18 distinct cells** (dedupe by cell, fan out to 21 terminal rows) - 36 calls/hour, ~26k/month, far inside "generous". 30 min catches forecaster amendments promptly while acknowledging `s-maxage=3600` means sub-hourly polling mostly re-reads CDN cache; hourly polling (13k/mo) is the acceptable floor if cost review ever cares.
- Per docs, on 429/5xx: one retry after ~5 s with jitter, then keep the last-good value for that cell and stamp it stale. Per the silent-fallbacks rule: emit an EMF metric + log line whenever a cell serves last-good instead of fresh - a swallowed 503 must not look like success.
- Sends the descriptive User-Agent with contact email on every call; auth kept injectable for the announced API-key future.

**Contract `/data/weather.json` (v1)**, snapshot to the data bucket, CloudFront TTL ~5 min:

```json
{
  "v": 1,
  "generated_at": "2026-08-19T23:30:00Z",
  "source": "NWS api.weather.gov",
  "terminals": {
    "7": {
      "grid": "SEW/124,68",
      "as_of": "2026-08-19T18:26:45Z",        // NWS updateTime, never fetch time
      "temp_f": 70,
      "short_forecast": "Mostly Sunny",
      "pop_pct": 0,
      "wind_mph": 3, "wind_dir": "NW", "wind_raw": "3 mph",
      "icon": "sct", "is_day": true,
      "stale": false
    },
    "19": { "unavailable": "outside NWS coverage (Sidney B.C.)" }
  }
}
```

- `icon` is the parsed token (skc/few/sct/bkn/ovc/rain/rain_showers/tsra/...), mapped client-side to the site's own icon set - never the deprecated NWS icon URL.
- Honesty rules carried over from stats/alerts: `as_of` on every terminal, `stale: true` + aging `as_of` when serving last-good, labeled `unavailable` for Sidney rather than a silent omission or a guessed value. Client detects pipeline death via `generated_at` aging, exactly like fleet.json.
- Trip-planner extension (v1 optional, or a sibling `/data/weather-hourly.json`): per terminal, the next 24 hourly periods trimmed to `{t, temp_f, pop_pct, wind_mph, icon}` so the planner can show weather at the departure hour, not just now (~25-30 KB gzipped for 21 terminals - still trivially inside snapshot economics).
- Synthetic Eagle Harbor (122) shares Bainbridge's cell for free via the cell fan-out; include it for map completeness, mark `synthetic` upstream as today.

**Cost:** ~1,440 Lambda invocations/mo x (18 HTTP fetches, ~3 MB in, one ~3 KB S3 put) - pennies; no new hot-path infrastructure; zero API fees.

## Evidence inventory

- `scratchpad/nws/points-{seattle,bainbridge,anacortes,porttownsend}.{json,headers}` - step-1 captures
- `scratchpad/nws/hourly-{four terminals}.{json,headers}` - step-2 captures (156-period bodies)
- `scratchpad/nws/grid-resolution.json` - all 21 terminals resolved (the 18-cell measurement)
- `scratchpad/nws/hourly-all-cells.json` - 18/18 cells verified serving forecasts, same-hour cross-Sound values
- `scratchpad/nws/{midsound,offshore,offshore-hourly,canada,precision,noua}.json` - failure-surface probes
- `scratchpad/nws/forecast12-seattle.json` - 12 h product shape (ranges + split icons)
- `scratchpad/nws/docs.html`, `scratchpad/nws/openapi.json` - official docs (rate limit, UA policy) and spec (icons `deprecated: true`)
- `scratchpad/nws/openmeteo.json` - Open-Meteo keyless probe

## AirNow verification (2026-08-19, added after the NWS exploration)

Key: free EPA registration, stored as SSM SecureString
`/wsf/prod/airnow-api-key` (set via CLI, never in TF state).

All 21 terminals probed via
`/aq/observation/latLong/current/?distance=30` with the pinned
coordinates. Results:

- **20 of 21 covered by 6 distinct reporting areas**: Anacortes (5
  terminals incl. all San Juans), Bremerton-Silverdale-Bainbridge Island
  (5), Seattle-Bellevue-Kent Valley (4), Everett-Marysville-Lynnwood (2),
  Port Townsend (2), Tacoma-Puyallup (2). Sidney B.C. has no monitor in
  range - the same labeled absence as NWS.
- Differentiation observed live at probe time: Seattle PM2.5 AQI 54
  (Moderate) vs Port Townsend 22 vs Tacoma 42 - the cross-Sound spread
  the feature exists to show.
- Parameters vary by area (O3+PM2.5+PM10 in Seattle; PM2.5-only in
  Bremerton/Port Townsend/Tacoma). Overall AQI = the worst reporting
  parameter (EPA convention); the poller records which pollutant won.
- Quirk: `LocalTimeZone` is always "PST" year-round; `DateObserved`
  carries a trailing space. The contract publishes the raw observed
  date+hour and lets the client render it.
- The poller queries one representative terminal per AREA (6 calls per
  run, not 21) - representatives pinned in gridcells.json.

## Pinned resolution (gridcells.json)

`tools/weather/resolve-gridcells.py` resolves every terminal once and
commits `services/weather/src/wsf_weather/gridcells.json`: 20/21
NWS-covered across 19 distinct SEW grid cells (Orcas+Shaw share 115,118;
Bainbridge+Eagle Harbor share 119,70), every cell verified serving 156
hourly periods at resolution time. Re-run only if WSF moves a terminal
or NWS re-grids; the diff is the review.
