# F1: Realtime vessel map

Living reference for the product's centerpiece (PRD F1). Updated whenever
the feature changes.

## Goal

Live fleet positions on a Paper Sound map of Puget Sound, honest to the
second: every marker states what it is (underway, docked, resting at the
yard, or stale), and nothing stale is ever plotted as live. Includes the
ambient "frame on a wall" mode (`/ambient`) that runs unattended for days.

## Target users

- **The commuter**: glances at the map to answer "where is my boat, really?"
- **The wall-display owner**: runs ambient mode on a spare screen all day;
  the map is furniture that happens to be true.

## Dependencies

- Upstream: `vessellocations` (~5 s server refresh, polled at 15 s),
  `vesselverbose` + `terminallocations` dims (re-fetched only when the
  sub-API `cacheflushdate` token moves).
- Verified quirk handling lives in `libs/wsf-core` (the PRD-mandated shared
  library): .NET dates, staleness precedence (stale > yard > docked >
  underway), synthetic terminal 122, the 400+Message auth signature.
- Serving: ADR-0005 snapshot on S3 behind CloudFront (`/data/fleet.json`,
  ~5 s TTL, CORS). No API Gateway in the hot path.
- Design: ADR-0002 Paper Sound; tiles per ADR-0003 (OpenFreeMap public
  instance + self-hosted style/glyphs/sprites + PMTiles fallback).

## Why it is built this way

- **Snapshot serving** makes viewer cost O(1): an ambient tab polling all
  day costs the same as none (CloudFront absorbs it); freshness p95 ~22 s
  at the edge against a 30 s SLO. Full trade study in ADR-0005.
- **Write-dedup on TimeStamp** halves DynamoDB idle cost (~$0.98 vs $2.27
  per month); validated by the `VesselsWritten` metric.
- **Staleness is computed at ingest and carried everywhere** because
  out-of-service vessels keep positions up to 45 days old - a map that
  trusts row presence draws ghost ferries.
- **The archive stores raw rows verbatim** (not parsed models): parsing
  drops fields by design; the archive's job is preserving what upstream
  actually said, for M4 replay.

## Status

- Data path: **live** (2026-07-29). `https://ferrysound.com/data/fleet.json`
  + dims; alarms tested end to end (auth canary fired on the deploy-time
  placeholder and cleared when the real code landed). Gate-2 in-region
  p95 ~20 ms recorded in ADR-0001.
- Frontend: **live** (2026-07-29). The full map with all four vessel states,
  vessel detail card (honest delay rules with plausibility caps), and
  `/ambient` with the 24 h guarantees (wake lock, 04:10 reload,
  outage-recovery reload).
- Freshness SLO measured at the edge 2026-07-29: rendered-position age
  p95 ~= 29 s vs the 30 s SLO (10 samples over 2 min + client interval;
  ADR-0005 predicted 28.2 s).
- Outstanding: the 24 h ambient soak on a physical tablet, and the
  "stranger calls it beautiful" gate - both Ryan-side; the PMTiles switch
  test records into tools/pmtiles/RUNBOOK.md.
