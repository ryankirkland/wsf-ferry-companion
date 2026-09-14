# F2: Sailing schedule

Living reference for PRD F2. Updated whenever the feature changes.

Named "Trip planner" until 2026-08-30, when the owner renamed the surface
to **Sailing schedule** - it lists the day's sailings rather than planning
anything. The rename is display-only: the route (`/trip/{slug}`), the
component directory, the `nav-trip` analytics label and the PRD's M2
milestone name all keep the old identity, so links, saved runs and the
analytics series stay continuous.

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
- `/data/alerts.json` - slimmed active alerts (title, text, body as
  plain text, route_ids, content-digest watermark). The route banner is
  M2's same-day cancellation surface; free-text sailing extraction is M3
  scope. The UI stamps every alert with its publish time (Sound-time
  clock if today, short date otherwise) - a 9 AM delay notice means
  something different at 5 PM. WSF publishes three strings per bulletin:
  AlertFullTitle, RouteAlertText (`text`) and BulletinText (`body`,
  added 2026-09-03 - optional in the type because older documents lack
  it). For most bulletins title and text are the same sentence typed
  twice, drifting only in spacing and punctuation ("Edm/King- Boarding"
  vs "Edm/King - Boarding"), and the substance lives in the body, so the
  UI prints under the title only the texts that say something the title
  did not: `alertDetails()` (`web/src/lib/trip/alert-text.ts`, shared
  with the account page's all-alerts list; `wsf_core.alert_text` is its
  Python twin for the alert email) folds case/punctuation/whitespace,
  drops a text the title already covers and a text another candidate
  contains in full. It never drops a text that EXTENDS the title - that
  is where the cancellations live ("The 0405 VASH>FAU ... are
  cancelled"), and hiding those would cost a rider a sailing. Owner's
  call, 2026-08-30: "why do these alerts have unnecessary sub text?"
- `/data/adjustments.json` (added 2026-07-29) - every timeadj row
  expanded to per-date entries (date, route_id/name, dep terminal,
  add|cancel, tidal, HH:MM local), past dates dropped. Published on
  full rebuilds - timeadj only moves with the schedule token. The
  `/calendar` month-grid page that rendered it was REMOVED at the
  owner's acceptance walk (2026-08-19: "not useful"); the contract
  stays published because pair-day notes consume the same upstream
  and a future surface may want it.

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
To-list only offers real mates. The masthead and h1 are server-rendered in
the page file with the `useSearchParams` Suspense boundary BELOW them
(2026-08-18): with the whole page inside the boundary, the static export
shipped an empty `<body>` for all 38 pairs - the highest-search-intent
routes on the site delivered title+description and nothing else. Keep any
new statically-derivable shell content in `page.tsx`, not `TripView`. The slug map `web/src/lib/trip/pairs.ts` is
GENERATED from the live index by `tools/fixtures/build-trip-fixture.mjs`;
a vitest drift test compares it against the checked-in index fixture - WSF
adding/dropping a pair fails CI and the regeneration script is the fix.

Page anatomy: pair header (h1 with each terminal's weather chip under
its own name - see weather.md; a one-line meta row: swap link, "Reserve a
vehicle spot" linking WSF's Save A Spot on reservable routes, "Get
alerts") -> route-matched alert banner (the same-day-truth surface) ->
answer line ("Next boat:
5:30 PM - leaves in 42 min · Wenatchee is at the dock") -> departures with
signal pills and today's live drive-up space on the card itself (earlier
sailings collapsed; the F5 join and its honesty rules live in
docs/features/stats.md) -> 14-chip date strip (`?date=` bounded today..+13,
out-of-range clamps with an honest note) -> collapsible fares panel
(basic 13 default, honest effective label).

Navigation (reworked at the owner's 2026-08-19 walk): the boat-button
drawer (live map, sailing schedule, "your run", on-time record, Ferry
Alerts, ambient, account) now renders on every page except /ambient;
wide screens additionally get a persistent SideNav rail, and non-map
mastheads lead with "Back to map" instead of the wordmark. Coaching
words ("relax", "keep moving") are gone from the answer line - the
countdown and tone color carry the judgment. Signal pills mark only states that
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
Cancels resolve against the row at their Sound-local instant
(`soundLocalMs`; pre-03:00 times name the service day's post-midnight
morning; yesterday's file contributes only its tail - on BOTH branches, so
its 22:00 cancel never strikes today's 22:00). `matched` is the builder's
"two-terminal route" flag: a matched cancel with a row strikes it with a
reason; a matched cancel with no row - WSF drops advance-published (tidal)
cancels from `/schedule/{date}` itself, so the sailing is simply absent -
becomes a `GhostCancel` rendered by `CancelledSlotRow` IN the list at the
cancelled time ("Sailing removed by WSF"). An UNMATCHED cancel
(Fauntleroy/Vashon/Southworth, the San Juans: timeadj names only the
departure terminal, so the boat may have been bound elsewhere) never
strikes: with a same-time row it becomes a hedged note on that live row
("WSF lists a 14:05 tidal cancellation from this terminal - it may be this
sailing"); with none, a hedged ghost ("A sailing from this terminal ... may
have been bound elsewhere on this route"). Past ghosts dim and collapse
with the earlier sailings; a future ghost always shows, even ahead of the
next real boat, and a day WSF cancelled outright still lists its ghosts
under "No sailings". The row links
"See WSF alert" to the route bulletin that names the slot (`slot-alert.ts`:
WSF's "0405", "04:05" and "4:05" forms as whole tokens, tidal notices as
the fallback for tidal cancels), opening the `<details>` before the anchor
jump. Owner's 2026-09-13 call: the old day-level note "floated above all
slots" and pointed at "the alert" without naming one. Empty/exhausted days
show tomorrow's first sailings.

Row meta says who can board per sailing (`LoadingRule` 1 "Passengers
only" / 2 "Vehicles only", or the quirk-filtered route flag) - the old
route-level "Passengers only" badge sat over the whole day, and the dev
fixture still carried the RouteID 8 false flag production had already
suppressed (fixed 2026-09-13). The "~N min crossing" badge is gone: every
row already prints "~ arrives".

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
