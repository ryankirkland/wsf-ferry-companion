# F4/F5 - Reliability statistics and live capacity

## Goal

Answer one rider question the schedule cannot: **"is my usual sailing typically late?"** Not
"how is the ferry system doing" in the abstract, but this pair, at this time of day, with enough
history behind it to mean something - and an honest admission when there is not.

F5 rides alongside: for the terminals that report drive-up space, show how full the next
departures are, and say nothing at all where the feed is silent.

## Target user

The commuter who already knows the schedule. They are choosing between the 5:20 and the 6:20,
or deciding whether to leave now for the drive-up lane. They do not want a dashboard; they want
one number they can trust, with its sample size next to it.

## Where the numbers come from

```
vesselhistory (nightly + 24-year backfill)
  -> raw/vesselhistory/ NDJSON                       [sync Lambda, 03:30 PT]
  -> analytics/history/year=YYYY/part-0.parquet      [transform Lambda, chained]
  -> Athena (Glue partition projection, 2002-2035)   [stats Lambda, chained]
  -> /data/stats/summary.json + /data/stats/pairs/{dep}-{arr}.json
```

Nothing queries Athena at request time (ADR-0005). Each stage invokes the next on success, so
ordering is causal rather than a bet that one cron finishes before another starts. A 05:15 PT
catch-up cron runs the stats stage independently, which keeps the 06:00 PT freshness SLO even if
the chain breaks upstream.

**Dataset as of 2026-07-30**: 3,493,725 sailings, 2002-03-01 to 2026-07-30, 30 vessels,
25 single-file year partitions, ~46 MB Parquet. A full nightly suite scans ~237 MB (~$0.0012).

## The honesty rules

These are the reason the feature exists in this shape. Each one is enforced in code, not
convention.

**Every number carries its window and its n.** `summary.json` and each pair file publish
`{n, ontime_pct, p50, p90}` for two windows: `primary` (last 90 days, derived from the data's
last service date - if collection stalls the window follows the evidence) and `all_time`.

**On-time means within 10 minutes of scheduled departure**, over sailings that actually
departed. Rows without an actual departure are excluded from the denominator rather than
counted late.

**Thin slots degrade and say so.** A scheduled slot with fewer than 30 departures in the window
leads with its hour bucket and sets `basis: "hour"`. Its own thin numbers stay in
`slot_window`, so a page can show "the 07:00 hour runs 81% on time; this particular sailing has
only run 4 times." Weekend-only sailings (~26 departures per 90 days) legitimately land here -
that is the rule working, not a bug.

**Cancellation is measured, never inferred.** vesselhistory has no cancelled flag, so a
`cancelled` column would only ever be a hardcoded `false` published as fact. Instead
`reconcile.py` diffs each day's *archived published schedule* against the sailings the fleet
reported. Consequences, all stated in the contract:
- Tracking starts **2026-07-29**, the first day of schedule archiving. No retroactive estimates.
- It compares the last schedule snapshot taken on or before the end of that service day - the
  plan riders actually saw. A sailing cancelled early enough to be pulled from the schedule is
  invisible, so the published rate is a **floor**, and the `note` field says so.
- Only **complete** service days are reconciled. The newest day in the history is the day
  collection stopped partway through.
- A terminal-day with a schedule but zero reported departures counts as `unreconciled_days`,
  never as a 100%-cancelled day. Collection gaps do not get to masquerade as service failures.

### The matching unit (a correction, measured 2026-07-31)

The first implementation diffed full `(departing, arriving)` pairs and produced a **19.8%**
cancellation rate on a normal Wednesday. It was wrong, because the two sides count different
things:

| | unit | example |
|---|---|---|
| Schedule `TerminalCombos` | the rider's **journey** | Anacortes -> Friday Harbor, listed even though the boat calls at Orcas first |
| vesselhistory | the physical **leg** | the same sailing, logged as Anacortes -> Orcas |

Diffing journeys against legs reads every multi-stop sailing as a cancellation. The evidence was
in the shape of the error: gaps of 80% on Fauntleroy->Southworth and 83% on Orcas->Shaw - exactly
where WSF interlines - while point-to-point runs (Bainbridge, Bremerton, Edmonds-Kingston,
Coupeville-Port Townsend) came out clean.

The fix matches on `(service_date, departing terminal, HH:MM)`: **did a boat leave that dock at
that minute?** That is also the question the rider is asking. Same day, same data: **3.4%**
unmatched, scattered singletons rather than whole routes.

The tradeoff is documented in code: if two boats were scheduled out of one dock in the same
minute and only one sailed, this method misses it. That biases toward under-reporting, which is
consistent with publishing the number as a floor.

**Collection gaps are labeled.** `coverage.thin_days` lists recent days whose sailing count fell
below half the recent median, so a half-collected day is visible rather than quietly averaged in.

**Superlatives require a real sample.** "Most punctual vessel" needs 200+ sailings in the window,
pair superlatives need 100+. A boat with a 99.9% record over 50 sailings does not get crowned.

**Retired pairs stay out of the page set.** Sidney B.C. and Keystone-era sailings remain in the
system rollup and in Athena, but no pair page is published for a route that no longer runs.

## Contracts

`/data/stats/summary.json` - system on-time for both windows, `by_year` (24-year trend),
`by_month`, per-vessel table, superlatives, coverage block (span, sailings, vessels, thin days),
cancellations block.

`/data/stats/pairs/{dep}-{arr}.json` - pair headline for both windows, `slots[]` (each with
`hhmm`, `basis`, `primary`, `slot_window`, `all_time`), `seasons[]`, and the pair's
cancellation rollup. Keyed by terminal IDs, not slugs, so a terminal rename never breaks the file
name.

Both stamp `generated_at` and `data_through`, and both are cached `max-age=300`.

## Dependencies

- `wsf_core.slips` - the slip-name to TerminalID map. History reports slip names, never terminal
  names, so this is the only join path. All 22 names in the 4.06M-row corpus are mapped.
- `data/pairs/index.json` - names and slugs for published pairs; a pair absent here gets no page.
- `raw/schedule_refresh/` - the archived pair-day schedules that make reconciliation possible.
- Glue partition projection (`year` 2002-2035). The location template must match the Parquet
  prefix byte for byte; a mismatch returns zero rows silently.

## How the SQL is verified

`test_queries.py` asserts STRUCTURE - the sailed-denominator guard, the
paired window columns, the on-time constant matching the contract, seasons
covering the calendar once, and every interpolated cutoff arriving as a
real `DATE 'YYYY-MM-DD'`. Without a Trino engine it cannot prove a query
returns the right rows.

The semantic check is a **run against Athena**, which belongs to deploy
rather than CI. `services/analytics/verify_queries.py` runs the whole
suite and reports rows + bytes scanned:

```bash
eval "$(aws configure export-credentials --profile ryan --format env)"
AWS_DEFAULT_REGION=us-west-2 uv run python services/analytics/verify_queries.py
```

Last run 2026-07-31: all 10 queries returned, **237 MB scanned** for the
full suite (about $0.0012). Run it after editing any query.

## Alarms

`stats-not-fresh` (no publish in 24h, missing data breaches - the SLO alarm), `stats-data-lag`
(published stats trail the calendar by >2 days), `analytics-unmapped-slip` (vocabulary drift put
sailings in quarantine), `analytics-history-failures` (3+ vessels failed a sweep),
`analytics-empty-night` (every vessel returned []), `analytics-backfill-zero`, plus per-function
Lambda error alarms for transform and stats.

## Live capacity (F5)

The capacity poller archives `terminalsailingspace` every minute, 24/7 - including the empty
overnight responses, which re-verify the coverage quirk rather than hiding it - and publishes
`/data/capacity.json` from the same fetch.

The contract's shape came from scanning 319 snapshots / 9,111 departures (2026-07-31), not from
assumption:

- **13 terminals report**, not the ~6 the plan assumed. **23 of the 38 published pairs** ever
  carry capacity, so the absent case is the common case.
- `DriveUpSpaceCount` is never null. `DriveUpSpaceHexColor` takes exactly three values -
  `#00FF00` plenty (7,739), `#FFFF00` filling (962), `#FF0000` full (410) - which is WSF's own
  fullness judgment, passed through rather than reinvented. An unrecognized code yields a null
  level and the raw count, never a guessed level.
- **No percent-full is published - though not for lack of a total.** `MaxSpaceCount` is present
  in 100% of records, so `drive_up / max` is arithmetically available. It is withheld because
  the two fields measure different things: drive-up availability over a total that includes
  reservable inventory we cannot see (`ReservableSpaceCount` appears in 220 of 9,111). The
  ratio would imply we know how full the boat is. Spaces remaining is also more actionable.
- **The count goes negative** in 197 of 9,111 records (2.2%) when queued vehicles exceed the
  boat, always carrying WSF's own red colour. The contract keeps the raw value; the page
  renders "Full", because "-15 spaces" is not a number of anything.
- Each departure carries a live `IsCancelled` flag, passed through and kept distinct from the
  historical reconciliation above.

The contract is keyed by pair (`"3-7"`), because a rider asks about their run, not their
terminal. `reporting_terminals` exists so the UI can distinguish "this terminal publishes no
drive-up data" from "no room left" - the page says the former in words and never renders an
empty gauge that could read as the latter. Readings older than four minutes are labeled stale.

Three absence states, because collapsing them produces a false statement (caught on production
at 01:00 PT, where the page told a rider that Bainbridge "does not report drive-up space" -
Bainbridge reports all day):

| state | what the page says |
|---|---|
| `reporting_terminals` is empty | "WSF is not publishing drive-up space for any terminal right now" - the feed goes quiet overnight, and that is a fact about the feed |
| Terminals reporting, but not this one | "{Terminal} does not report drive-up space to WSF… not a sign the lot is full" |
| This terminal reports, no upcoming sailings listed | "No upcoming departures… are reporting drive-up space right now" |

## The pages

**Pair page** (`/trip/{slug}`). Drive-up space renders ON the departure card it describes
(owner's call, 2026-08-30) - it was a separate "Drive-up space" section below the schedule,
which asked the rider to match clock times across two lists to answer one question: "will I get
on THAT boat?" The reading is joined to the sailing by `depart_ms`, the same scheduled-departure
instant WSF puts on both feeds (`Departure` in terminalsailingspace, `DepartingTime` in the
schedule), so a reading with no matching card simply does not render - the join is exact by
construction, and `tests/e2e/stats.spec.ts` fails if it ever stops landing.

What the move preserved, changed, and dropped:

- The three absence states above still print, in `DriveUpNote` under the list, along with the
  as-of stamp, the staleness label, and what the number counts.
- A card already struck as cancelled carries no space count; the capacity feed's own
  `IsCancelled` still shows as "Cancelled" on cards the schedule has not struck.
- Space renders for **today only**. The feed is current-state, so a future date shows no
  numbers at all rather than today's lot under tomorrow's sailings - the old section rendered
  regardless of the date being browsed.
- The **meter bar did not survive**. It drew `drive_up / max_space`, which is precisely the
  ratio this contract refuses to publish (see above: `max_space` includes reservable inventory
  we cannot see). The count and WSF's own colour carry the same judgment without implying we
  know how full the boat is.

Reliability picks the rider's own departure out of the slot table by Sound-local `HH:MM` - the
same key the contract uses - and leads with it. A degraded slot shows the hour bucket, marks
itself `hour`, and a legend under the table explains the marker; the slot's own thin count stays
visible so the reader can judge the evidence. Cancellations print a count rather than a rate
until a week of tracking exists.

**`/stats`** carries the system view: a bar per year since 2002 (every fifth year labeled, since
25 labels do not fit a phone), a month grid, the most and least dependable routes, a per-boat
table, and the coverage and cancellation caveats in full.

Vessel names are repaired for display by `wsf_core.vessel_names`: the history feed answers
"WallaWalla", riders know the boat as "Walla Walla". The map comes from the live fleet dim, plus
a curated entry for boats retired before that dim existed (`Evergreen` -> `Evergreen State`).
The Parquet keeps the feed's spelling, because it is ground truth and must stay re-derivable.

## History

- 2026-08-01: closed the two untested modules in the analytics path -
  `athena.py` (the runner every statistic passes through) and `queries.py`
  (the SQL itself), plus a repeatable Athena verification script.
- 2026-07-31: F4/F5 frontend (W1) - reliability + capacity on pair pages, `/stats` overview,
  `/data/capacity.json` publisher, vessel display-name repair.
- 2026-07-31: F4 backend complete (D3) - stats + reconciliation + alarms.
- 2026-07-30: 24-year backfill transformed to Parquet and verified against Athena (D2).
