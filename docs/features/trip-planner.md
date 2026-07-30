# F2: Trip planner

Living reference for PRD F2. Updated whenever the feature changes.

## Goal

"Do I run for the 5:30 or relax for the 6:20?" - answered in under ten
seconds: next sailings for a terminal pair with an honest live signal per
departure, trip fares, and day-view browsing bounded to what upstream can
actually serve.

## Target users

The commuter, primarily; the data-curious rider gets honest fare tables.

## Serving decision (extends ADR-0005; no new ADR - same pattern, new projection)

Materialized JSON on the existing data bucket + `/data/*` CloudFront
behavior. The make-it-or-miss-it join is client-side (the page already
polls `fleet.json`), so a server API would compute nothing the client
cannot; materialization keeps one serving pattern, edge latency inside the
10 s answer budget, O(1) spike behavior, ~+$0.16/mo. **Verified join
(live probe 2026-07-29): `vessellocations.ScheduledDeparture == schedule
Times.DepartingTime` to the epoch millisecond; key (VesselID, ms), 6/6
across 5 routes.**

## Public contracts (all `"v": 1`)

- `/data/pairs/index.json` - 38 pairs, terminals, crossing_min (null for
  ana-sj: UI omits arrival estimates), reservable/passenger-only flags,
  collection hints, horizon (today..+13; past dates are impossible
  upstream - blocker quirk; deeper future dates -> wsdot.wa.gov, honestly).
- `/data/pairs/{dep}-{arr}/{YYYY-MM-DD}.json` - sailings with `depart` ISO
  + `depart_ms` (the verbatim join key; invariant unit-tested), vessel
  id/name, accessible, loading_rule, `after_midnight` tail tags, `added`,
  resolved note strings, `adjustments[]` (timeadj-matched cancels with
  reasons; timeadj is annotation, not schedule math - `/schedule/{date}`
  already applies it). Cross-file tail dedup on (vessel_id, depart_ms).
- `/data/fares/{dep}-{arr}.json` - one-way + round-trip line items resolved
  ONLY via LineItemLookup (the positional-zip trap misprices 13 combos incl.
  Mukilteo-Clinton; regression-tested at $7.10), Decimal-as-string amounts,
  `basic` flags (curated 13), collection hint, synthesized effective label
  ("fares for travel {trip_date}, retrieved {date}" - upstream has NO
  effective-date field; future-date browsing notes today's tables shown).
- `/data/alerts.json` - slimmed active alerts (plain text, route_ids,
  BulletinID+PublishDate watermark). The route banner is M2's same-day
  cancellation surface; free-text sailing extraction is M3 scope. The UI
  stamps every alert with its publish time (Sound-time clock if today,
  short date otherwise) - a 9 AM delay notice means something different
  at 5 PM.
- `/data/adjustments.json` (added 2026-07-29) - the season-wide service
  calendar: every timeadj row expanded to per-date entries (date,
  route_id/name, dep terminal, add|cancel, tidal, HH:MM local), past
  dates dropped. Published on full rebuilds - timeadj only moves with
  the schedule token. Rendered at `/calendar` as month grids; days
  inside the 14-day horizon deep-link to the pair page for that date,
  deeper dates are information only (upstream cannot serve them yet).

## Dependencies

schedule/{date}/{dep}/{arr}, terminalsandmates, routedetails (CrossingTime
strings), timeadj (1900-PST sentinel times -> `parse_dotnet_time_of_day`),
farelineitemsverbose + terminalcomboverbose, alerts, both cacheflushdates,
validdaterange (floor = server today; handles the midnight-lag quirk).
`WsfBadRequestError` discrimination keeps bad pairs/dates off the auth
canary.

## Ingest (M2)

`wsf-prod-ingest-schedule` (15 min; token+horizon gated; 14-day rebuild
~3-4 min at 300 ms spacing; archives everything raw - the API cannot serve
the past, so the raw archive is the only history, load-bearing for M4;
`today-refresh` mode re-pulls today's 38 pairs on alert change and logs
`ScheduleDivergence` - the standing instrument for whether `/schedule/{date}`
drops same-day-cancelled sailings). `wsf-prod-ingest-alerts` (1 min,
watermark-gated, triggers today-refresh). PAIR# DynamoDB items for
today+tomorrow (M3's evaluator substrate; expires_at = depart+6h).

## Frontend (M2)

38 pre-rendered pages `/trip/{dep-slug}-{arr-slug}` (generateStaticParams +
`dynamicParams=false`; junk slugs are real 404s) plus a `/trip` picker whose
To-list only offers real mates. The slug map `web/src/lib/trip/pairs.ts` is
GENERATED from the live index by `tools/fixtures/build-trip-fixture.mjs`;
a vitest drift test compares it against the checked-in index fixture - WSF
adding/dropping a pair fails CI and the regeneration script is the fix.

Page anatomy: pair header (swap link, crossing badge) -> route-matched
alert banner (the same-day-truth surface) -> answer line ("Next boat:
5:30 PM - leaves in 42 min · Wenatchee is at the dock") -> departures with
signal pills (earlier sailings collapsed) -> 14-chip date strip (`?date=`
bounded today..+13, out-of-range clamps with an honest note) -> collapsible
fares panel (basic 13 default, honest effective label).

Navigation: the map carries a boat-button (bottom-left) opening a drawer
with the trip planner, "your run", the service calendar, and ambient mode
- /ambient itself stays chromeless. Signal pills mark only states that
demand a glance (boarding, leaving now, running late, departed/gone,
no-signal); tight/comfortable rows let the countdown speak for itself
(Ryan's call, 2026-07-29).

Signal engine (`lib/trip/signal.ts`, pure, exhaustively table-tested):
states cancelled / departed / gone / boarding / late-start / leaving-now /
tight / comfortable / no-signal, joined to the fleet snapshot on
`Date.parse(fix.sched) === sailing.depart_ms`. Honesty rules baked in:
stale fixes are discarded, never dressed as live; the -3..0 min window
with no fix reads "no live signal" rather than guessing; departure deltas
render only within 1-120 min plausibility; countdowns beyond 120 min
switch to clock time. Thresholds (green >25, amber 10-25, red <=10) live
in `web/src/config.ts`.

Day view (`lib/trip/day.ts`): before 3 AM Sound time yesterday's
`after_midnight` tail merges in (dedup on vessel_id+depart_ms), covering
the ~1 h upstream server-day lag when today's file may not exist yet.
Matched cancels strike rows with a reason; unpinnable ones surface as
day-level notes. Empty/exhausted days show tomorrow's first sailings.

Dev fixtures re-time a real pair-day around load time via a placeholder
grammar (`%%MS±n%%`), so every signal band renders at once in dev and in
`tests/e2e/trip.spec.ts` without waiting for real boats.

## Probe results

- Annotations elements: **plain strings**, positionally indexed
  (fauntleroy-vashon live probe 2026-07-29: "Via Southworth, crossing time
  45 minutes."). Defensive resolver retained.
- routedetails.PassengerOnlyFlag is upstream-false for RouteID 8
  (pt-key): the route sells vehicle fares. Suppressed via
  `wsf_core.quirks.FALSE_PASSENGER_ONLY_ROUTE_IDS` (found 2026-07-29 when
  the live trip page badged a car ferry "Passengers only").
- Advance-published tidal cancels are ALREADY dropped from
  `/schedule/{date}` Times (Aug-10 pt-coupeville, observed live
  2026-07-29): the matched cancel can't pin a row, so it surfaces as the
  day-level note - both the strike-through path (row present) and the
  note path (row absent) are real, and both are E2E-tested.
- LoadingRule 1/2: pending first production sweep of 532 pair-dates.
- Schedule-drops-cancellations: pending the next real disruption (the
  today-refresh diff auto-archives evidence).

## Status

- Backend live since 2026-07-29 (PRs #22-#25): all four /data contracts
  serving, 8 alarms OK, PAIR# items queryable, ~+$0.16/mo.
- Frontend built + E2E-tested 2026-07-29 (PR #26): 38 pair pages + picker,
  signal engine, fares, alerts, date browsing. Two live-caught fixes in
  the same PR (late-start window guard, PassengerOnlyFlag quirk).
- Remaining for M2 exit: <10 s answer measured on a phone against
  production; LoadingRule and schedule-drops-cancellation probes settle
  on their own instruments.
