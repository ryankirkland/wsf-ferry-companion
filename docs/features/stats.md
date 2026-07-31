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
- A pair-day with a schedule but zero reported sailings counts as `unreconciled_days`, never as
  a 100%-cancelled day. Collection gaps do not get to masquerade as service failures.

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

## Alarms

`stats-not-fresh` (no publish in 24h, missing data breaches - the SLO alarm), `stats-data-lag`
(published stats trail the calendar by >2 days), `analytics-unmapped-slip` (vocabulary drift put
sailings in quarantine), `analytics-history-failures` (3+ vessels failed a sweep),
`analytics-empty-night` (every vessel returned []), `analytics-backfill-zero`, plus per-function
Lambda error alarms for transform and stats.

## Live capacity (F5)

The capacity poller archives `terminalsailingspace` every minute, 24/7 - including the empty
overnight responses, which re-verify the coverage quirk rather than hiding it. Only a subset of
terminals report drive-up space; the rest are absent from the feed and must be absent from the
UI, with copy that says the terminal does not report rather than implying space is unknown or
full. Readings older than a few minutes are labeled stale.

## History

- 2026-07-31: F4 backend complete (D3) - stats + reconciliation + alarms. Frontend is W1.
- 2026-07-30: 24-year backfill transformed to Parquet and verified against Athena (D2).
