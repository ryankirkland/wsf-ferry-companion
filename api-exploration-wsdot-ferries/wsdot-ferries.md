# WSF Traveler Information API (WSDOT Ferries) - Agent Reference

**Explored:** 2026-07-24 · Column definitions: `facts.json` · Human reference: `report.html` · Raw samples: `samples/`

## Connection
- Base URL: `https://www.wsdot.wa.gov/ferries/api/{vessels|terminals|schedule|fares}/rest`
- Style: REST/JSON on .NET/WCF; XML via `Accept: text/xml` (probed 2026-07-24); JSON is the default. GET only, no pagination anywhere - collections return whole (largest seen: terminalverbose 270 KB, farelineitemsverbose 204 KB, one vessel-year of history 874 KB).
- Auth: `?apiaccesscode=<API_KEY>` on every call; GUID from free email registration at https://wsdot.wa.gov/traffic/api/ ; no documented expiry. Env var `WSF_ACCESS_CODE` (project `.env`). `/cacheflushdate` never needs it.
- Rate limit: undocumented; no limit headers observed (n=54 spaced calls, 2026-07-24). Stay polite: >= 1 s spacing, descriptive User-Agent.
- Failure surface (each probed separately, 2026-07-24): key absent -> 200 with full data (9,201 B, byte-identical to keyed call); key present but unregistered GUID -> 400 `{"Message": "...register..."}`; unknown query param (`bogusparam=zzz`) -> silently ignored, identical payload; unknown vessel name -> 200 `[]`; non-adjacent fare pair (7,8) -> 400 Message; out-of-range TripDate -> 400 Message. No 401/403 anywhere; no rate-limit responses seen.

## Endpoints (66 operations; ★ = authoritative per entity; full inventory in facts.json)
- ★ `GET /vessels/rest/vessellocations` - live position/ETA, one row per vessel (n=21); ~5 s server refresh (docs).
- ★ `GET /vessels/rest/vesselverbose` - vessel dim; superset of vesselbasics + vesselstats + vesselaccommodations (verified column union, 2026-07-24).
- ★ `GET /vessels/rest/vesselhistory/{VesselName}/{DateStart}/{DateEnd}` - UNDOCUMENTED; scheduled vs actual departure per crossing. Dates `YYYY-MM-DD`; year windows fine (2015: 3,388 rows, 874 KB, 2.7 s). Bare `/vesselhistory` returns one all-null row per vessel - useless.
- ★ `GET /terminals/rest/terminalverbose` - terminal dim (20 rows); superset of the other six terminals ops plus CMS extras.
- ★ `GET /terminals/rest/terminalsailingspace` - drive-up/reservable space per upcoming departure; current-state only; `[]` overnight (00:45 and 00:55 PT, 2026-07-24).
- `GET /terminals/rest/terminalbulletins` - 0..n HTML bulletins per terminal (24 rows over 17 of 20 terminals, 2026-07-24).
- `GET /terminals/rest/terminalwaittimes` - static arrive-early advisories, NOT live waits (see Gotchas).
- ★ `GET /schedule/rest/schedule/{TripDate}/{Dep}/{Arr}` - dated, adjustment-applied departures with real timestamps + VesselID (23 rows for 7-3 on 2026-07-24). Also `/{TripDate}/{RouteID}`. `/scheduletoday/...` = same Times minus past rows.
- ★ `GET /schedule/rest/sailings/{SchedRouteID}` - season structure: sailing groups -> Journs[] -> TerminalTimes[] (slip names + 1900 sentinel times). `/allsailings` byte-identical (md5, 2026-07-24).
- ★ `GET /schedule/rest/timeadj` - dated adds/cancels vs season schedule (n=108: 103 cancel / 5 add; 106 tidal).
- ★ `GET /schedule/rest/alerts` - active alerts (n=9); `RouteAlertText` carries operational detail as free text.
- `GET /schedule/rest/validdaterange` - queryable TripDate window; sampled 2026-07-23 -> 2026-12-26; identical to fares window.
- `GET /schedule/rest/{routes|routedetails}/{TripDate}` (date-scoped!), `/schedroutes`, `/activeseasons`, `/terminals|terminalsandmates|terminalmates/{TripDate}` - schedule dims.
- ★ `GET /fares/rest/farelineitemsverbose/{TripDate}` - every fare for every pair, one call (770 one-way line items across 38 pairs). Index-linked; resolve via `LineItemLookup` only.
- `GET /fares/rest/farelineitems[basic]/{TripDate}/{Dep}/{Arr}/{true|false}` - one pair (23 products; basic = popular 13, verified subset).
- `GET /fares/rest/faretotals/{TripDate}/{Dep}/{Arr}/{RT}/{ids}/{qtys}` - server-side basket total; ids/qtys are PARALLEL csv arrays. Verified: `1,2` / `2,1` -> 28.35 = 2 x 11.35 + 1 x 5.65 (2026-07-24).
- ★ `GET /fares/rest/terminalcomboverbose/{TripDate}` - fare-collection prose per pair (26/38 collect nothing at arrival side).
- `GET /{sub}/rest/cacheflushdate` - bare .NET-date string; poll to invalidate cached dims.

## Field Notes
- All timestamps: .NET `/Date(1784896200000-0700)/` - epoch ms is UTC; embedded offset is Pacific display. Parse ms, convert to America/Los_Angeles.
- `sailings.TerminalTimes.Time`, `timeadj.TimeToAdj`: 1900-01-01 PST sentinel, time-of-day only (90/90 and 108/108 rows, 2026-07-24).
- `vesselhistory.VesselId`: different id space (Tacoma = 1077/1088 vs 32 in dims; 0% join, n=148). Join on `Vessel` == `VesselName` (100%, n=148).
- `vesselhistory.Departing/Arriving`: slip names ('Colman', 'Bainbridge'); 0% match to `TerminalName` (n=148). Alias source: `sailings.TerminalTimes.TerminalBriefDescription` ('Colman P52' rides with TerminalID 7).
- `vesselhistory.EstArrival`: estimate; no actual-arrival field exists anywhere.
- `vessellocations.TimeStamp`: AIS report time; out-of-service boats carry stamps up to 46 days old (2026-06-08 seen on 07-24) - staleness-filter before display.
- `vessellocations.ArrivingTerminalID/Eta/LeftDock/ScheduledDeparture`: null while docked (85.7% null overnight, n=21) - semantic, not dirty.
- `vessellocations.DepartingTerminalID`: can be 122 (Eagle Harbor yard), which no terminals op serves.
- `vessellocations.OpRouteAbbrev`: JSON array of route slugs (usually length 1).
- `vesselstats.Beam/Draft/Length`: text with foot/inch marks (`328' 2"`), not numeric.
- `farelineitems.FareLineItem`, bulletins, route notes: contain HTML fragments - sanitize before display.
- `timeadj.AdjType`: 1 = added sailing, 2 = cancelled. `faretotals.TotalType`: 1 depart leg, 2 return, 3 direction-independent, 4 grand total.
- `schedule.Times.LoadingRule`: observed 3 = passengers + vehicles (docs prose: 1 pax-only, 2 vehicle-only).
- `alerts.AffectedRouteIDs`: int list; validate against season-wide schedroutes, not `routes/{TripDate}` (62% match there, n=21 ids).

## Joins (verified 2026-07-24)

- **Addendum (live probe 2026-07-29, mid-service):** `vessellocations.ScheduledDeparture == schedule Times.DepartingTime` to the exact epoch millisecond - 6/6 vessels across 5 routes; join key (VesselID, epoch-ms). Also probed: `/schedule/{date}` `Annotations` elements are plain strings ("Via Southworth, crossing time 45 minutes."), positionally indexed by `Times[].AnnotationIndexes`.
- `vessellocations.VesselID` -> `vesselbasics.VesselID` (1:1) 100%, n=21.
- `vesselhistory.Vessel` -> `vesselbasics.VesselName` (N:1) 100%, n=148; via `VesselId` 0%.
- `vesselhistory.Departing` -> `terminalbasics.TerminalName` 0%, n=148 (slip vocabulary; needs alias map).
- `vessellocations.DepartingTerminalID` -> `terminalbasics.TerminalID` (N:1) 86%, n=21 (all misses = 122).
- `schedroutes.RouteID` -> `routes.RouteID` 100%, n=15; `sailings.SchedRouteID` -> `schedroutes` 100%, n=4; `Journs.VesselID` -> vessels 100%, n=90; `TerminalTimes.TerminalID` -> terminals 100%, n=90; `timeadj.SchedRouteID` -> `schedroutes` 100%, n=108.
- `schedule Times.VesselID` -> `vessellocations.VesselID` (N:1) 100%, n=23.
- `terminalsandmates` (Dep,Arr) pairs == fares `terminalcomboverbose` pairs: identical sets, 38/38 (same TripDate).
- `farelineitemsbasic.FareLineItemID` subset of `farelineitems`: 100%, 13/23.

## Data Shape & Temporal
- Entities served: vessels (21; + nested class), current vessel positions (1/vessel), completed crossings (1/crossing, per vessel + window), terminals (20), terminal bulletins (0..n/terminal), sailing-space reports (per terminal x departure x arrival split; docs schema, overnight sample empty), seasons (2), routes (date-scoped) and route x season instances (15), sailing groups -> journeys -> stops (4 -> 90 -> 90 sampled), dated adjustments (108), dated departures (per pair/date), alerts (9), fare pairs (38), fare products (23/pair; 770 systemwide one-way).
- Update cadence: vessellocations + terminalsailingspace "potentially every 5 seconds" (docs; do-not-cache warning); alerts event-driven (PublishDate); dims change only with `/cacheflushdate` (observed stamps: vessels/fares 2026-07-23 20:56, terminals 00:50, schedule 00:55 on 07-24); schedules/fares republish per season.
- History depth: vesselhistory has data at 2002-03-01 (n=186 that week); no earlier probe attempted - floor at or before 2002-03 (measured 2026-07-24). Fresh to same night (00:15 sailing present in a 00:45 fetch). Everything else is current-state or forward-only: past TripDates return 400, so planned schedules/fares for a past date exist only if a consumer snapshotted them while current.
- Incremental pulls: vesselhistory by date window keyed on `ScheduledDepart`; alerts by `BulletinID` + `PublishDate`; everything else full-snapshot only.
- Coverage gaps are real: Tacoma's 2015 window starts 2015-03-28 despite a 01-01 request (out-of-service period; one call, 2026-07-24).

## Gotchas (by severity)
- 🛑 schedule + fares: no past TripDates - window starts at SERVER today (400 outside; sampled window 2026-07-23 -> 2026-12-26). Historical planned data exists only via consumer snapshots.
- 🛑 terminalsailingspace: current-state only, `[]` overnight (two fetches, 2026-07-24), and only a subset of terminals ever report (~6/20 in a prior daytime check, unverified 2026-07-24) - per-terminal or historical capacity cannot be assumed.
- ⚠️ vesselhistory: join by vessel NAME, never VesselId (0%, n=148); terminals arrive as slip names (0% direct match, n=148).
- ⚠️ sailings/timeadj stop times: 1900-01-01 sentinel - naive datetime math is off by 126 years; use `/schedule/{date}` for dated timestamps.
- ⚠️ terminal 122 (Eagle Harbor yard) appears in realtime feeds but has no dimension row - joins drop laid-up vessels (86%, n=21).
- ⚠️ terminalwaittimes looks live but is boilerplate: exactly two `WaitTimeLastUpdated` values fleet-wide (2020-08-18, 2025-08-18; n=21 rows).
- ⚠️ vessellocations rows can be weeks stale for out-of-service boats - trust `TimeStamp`, not row presence.
- ⚠️ alerts route ids exceed `routes/{TripDate}` (62%, n=21) - validate against the season-wide route set.
- ⚠️ farelineitemsverbose: 38 combos share 27 jagged price lists - resolve via `LineItemLookup`; positional zips silently misprice 13/38 combos (incl. Mukilteo-Clinton: $11.35 shown vs $7.10 real) and IndexError on 11 more whose lookup index exceeds the 27-list array. (Corrected 2026-07-29 by recount; original note said 11 mispriced.)
- ⚠️ vesselhistory names: spaces must be REMOVED, never percent-encoded - `WallaWalla` returns 8,157 rows (2015) while `Walla%20Walla` silently returns `[]` (probed 2026-07-30, n=3 encodings). The Evergreen State answers only to `Evergreen`. Retired vessels ARE served by name: Hyak 5,020 / Klahowya 8,191 / Elwha 3,073 (2015), Illahee 6,569 / Quinault 3,935 (2005), Hiyu 983 / Evergreen 6,673 (2010), Skagit 1,847 / Kalama 1,399 (2005); Rhododendron, Nisqually, Snohomish, Chinook returned 0 in probed active years (may be name variants - unresolved).
- ⚠️ routedetails.PassengerOnlyFlag can be upstream-false: RouteID 8 (pt-key, Port Townsend/Coupeville) reports `true` while its own farelineitemsverbose sells Vehicle Length-Based items and the route takes vehicle reservations (live probe 2026-07-29, n=1 route affected of 13 checked). Cross-check the flag against fare categories before surfacing it.
- ⚠️ unknown query params pass silently (identical payload); bad path values return 200 `[]` - validate inputs client-side, alarm on unexpected emptiness.
- ⚠️ server day boundary lags midnight: at 00:47 PDT on 07-24 the server called 7/23 "today's date" - both dates can be valid in the first hour(s).
- ℹ️ access code optional today, 400 if present-but-wrong (absent, registered, and invalid-GUID probed separately) - always send it; enforcement can start anytime.
- ℹ️ vesselhistory absent from official docs (WCF help only) - no contract; archive pulls, watch for drift.
- ℹ️ `allsailings` == `sailings` byte-identical; `scheduletoday` == `schedule/{today}` minus past rows - skip the duplicates.
- ℹ️ HTML inside text fields (fare labels, bulletins, notes) - sanitize; prefer plain-text alert fields.
- ℹ️ vesselstats dimensions are foot/inch strings - cast before math.
- ℹ️ vesselhistory windows can be legitimately empty mid-range (out-of-service) - cross-check sister vessels before reading absence as zero sailings.
