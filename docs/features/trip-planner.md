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
  cancellation surface; free-text sailing extraction is M3 scope.

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

## Probe results

- Annotations elements: **plain strings**, positionally indexed
  (fauntleroy-vashon live probe 2026-07-29: "Via Southworth, crossing time
  45 minutes."). Defensive resolver retained.
- LoadingRule 1/2: pending first production sweep of 532 pair-dates.
- Schedule-drops-cancellations: pending the next real disruption (the
  today-refresh diff auto-archives evidence).

## Status

- D1 (wsf-core modules, 400-fix, sentinel parser, resolver, corrections):
  in progress 2026-07-29.
