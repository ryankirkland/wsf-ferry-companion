# Architecture

Living document - updated every time deployed infrastructure changes
(CLAUDE.md mandate). Decisions behind the shapes: [ADR-0001](adr/0001-architecture-cost-bakeoff.md)
(serverless lakehouse), [ADR-0003](adr/0003-tile-hosting.md) (tiles),
[ADR-0004](adr/0004-state-backend-and-ci.md) (state + CI).

## Deployed today (M0 skeleton + M1 map + M2 trip planner + M3 alerts + M4 analytics)

```mermaid
flowchart LR
    WSF[WSDOT Ferries API]
    U([Rider's browser])

    subgraph ingest [Ingestion - live]
        EB[EventBridge Scheduler<br/>1 min + 15 min] --> POLL[Lambda poller<br/>4x15s loop]
        EB --> DIMS[Lambda dims refresher<br/>cacheflushdate-gated]
        EB --> SCHED[Lambda schedule refresher<br/>token + horizon gated, 15 min]
        EB --> AL[Lambda alerts poller<br/>watermark-gated, 1 min]
        AL -- "on change: today-refresh" --> SCHED
        AL -- "on change: full slim feed" --> NOTIF[Lambda notifier<br/>diff + match + capped SES fan-out]
        NOTIF --> SES2[SES ferrysound.com] --> SUBS([Alert subscribers])
        SES2 -- bounce/complaint --> SUP[Lambda suppress]
    end

    subgraph analytics [Analytics - live, M4]
        EB2[EventBridge Scheduler<br/>03:30 PT + 1 min + 05:15 PT] --> SYNC[Lambda history sync<br/>7-day window, per-vessel isolation]
        EB2 --> CAP[Lambda capacity poller<br/>terminalsailingspace, 24/7<br/>archives + publishes capacity.json]
        SYNC -- "touched years" --> XF[Lambda transform<br/>dedup + Pacific service year]
        XF -- "on success" --> ST[Lambda stats<br/>Athena suite + reconciliation]
        EB2 -. "05:15 catch-up" .-> ST
    end

    subgraph usw2 [AWS us-west-2]
        DDB[(DynamoDB wsf-prod-hot<br/>FLEET + META items)]
        RAW[(S3 raw archive<br/>gzipped NDJSON by fetch-time<br/>+ analytics/history Parquet)]
        GLUE[Glue catalog<br/>partition projection 2002-2035] --> ATH[Athena<br/>workgroup, 2 GB cutoff]
        DATA[(S3 data bucket<br/>fleet.json + dims)]
        WEB[(S3 web bucket<br/>Next.js static export)]
        ASSETS[(S3 map-assets bucket<br/>style + glyphs + sprites)]
        TILES[(S3 tiles bucket<br/>wa.pmtiles)]
        TLAMBDA[Protomaps Lambda<br/>tiles fallback]
        AGW[API Gateway HTTP<br/>api.ferrysound.com]
        HELLO[Lambda hello]
    end

    subgraph edge [Global edge]
        CF[CloudFront ferrysound.com]
    end

    WSF --> POLL
    WSF --> DIMS
    WSF --> SCHED
    WSF --> AL
    POLL --> DDB
    POLL --> RAW
    POLL -- every poll --> DATA
    DIMS --> DATA
    SCHED --> DDB
    SCHED --> RAW
    SCHED -- "pairs index + 532 day files + fares" --> DATA
    AL --> RAW
    AL -- alerts.json --> DATA
    WSF --> SYNC
    WSF --> CAP
    SYNC --> RAW
    CAP --> RAW
    CAP -- capacity.json --> DATA
    XF -- "year=YYYY/part-0.parquet" --> RAW
    RAW --> GLUE
    ATH --> ST
    ST -- "stats/summary.json + 38 pair files" --> DATA
    U -- HTTPS --> CF
    CF -- default --> WEB
    CF -- "/data/* (5s TTL)" --> DATA
    CF -- "/assets/*" --> ASSETS
    CF -. "/tiles/* (fallback)" .-> TLAMBDA --> TILES
    U -- HTTPS --> AGW --> HELLO
    OFM[OpenFreeMap tiles] -.-> U
```

The web app (ferrysound.com): Next.js static export, MapLibre GL on the
forked positron style (self-hosted at `/assets/style/positron-v1.json`),
fleet polled from `/data/fleet.json` every ~12 s, four vessel states,
`/ambient` wall mode with wake lock + daily reload, and the M2 trip
planner: `/trip` picker + 38 pre-rendered pair pages joining the fleet
snapshot to pair-day files client-side (ADR-0005 - no API in the hot
path). Deploys via `web-deploy.yml` two-pass sync + invalidation. Tiles
come from the OpenFreeMap public instance; the PMTiles fallback behind
`/tiles/*` is the tested escape hatch (ADR-0003 as amended).

Alarms (16, all to the `wsf-prod-alarms` SNS topic). Ingest (8):
poller-gap (the SLO alarm), auth-failure (400+Message canary),
empty-fleet, three Lambda-error alarms, schedule-refresh-errors,
pairs-stale. Notify (1): notifier-errors. Analytics (7):
stats-not-fresh (the F4 freshness SLO - missing data breaches),
stats-data-lag, unmapped-slip, history-failures, empty-night, and
Lambda-error alarms for transform and stats. Six sit past the 10-alarm
free tier (~$0.60/mo) - accepted deliberately, because each detects a
failure whose signature is silence. Account-level
(bootstrap stack): Terraform state bucket with native lockfile, GitHub
OIDC provider, plan/apply CI roles, $15 budget with three email
notifications.

## Product data model (ERD start - grows with each milestone)

**DynamoDB `wsf-prod-hot`** (single table, generic PK/SK, on-demand):

| Item | PK | SK | Content |
|---|---|---|---|
| Fleet position (21) | `FLEET` | `VESSEL#0038` (zero-padded VesselID) | name, lat/lon/speed/heading (N), at_dock, in_service, state, terminals, eta/left/sched ISO strings, source_ts, fetched_at |
| Poll health | `META` | `POLLER#vessellocations` | last_success/attempt, polls ok/failed, last_error |
| Refresh tokens | `META` | `CACHEFLUSH#vessels\|terminals\|schedule\|fares` | opaque cacheflushdate token |
| Pairs horizon | `META` | `HORIZON#pairs` | last published horizon window |
| Alerts watermark | `META` | `ALERTS#watermark` | `maxid:maxms` change gate |
| Departures, today+tomorrow (M2) | `PAIR#0007#0003` | `DEP#<iso>` | vessel, depart_ms; TTL `expires_at` = depart + 6 h; M3's alert-evaluator Query substrate |
| Bulletin state (M3) | `ALERTS` | `BULLETIN#<id>` | first_seen_ms, text_hash, gone_at; notifier-owned diff state |
| Subscriptions (M3) | `USER#<sub>` + `ROUTE#<rid>` mirror | `SUB#...` | pair, window, email; TransactWrite pairs |
| Send claims / caps (M3) | `USER#<sub>` | `SENT#<bulletin>` / `NOTIF#<date>` | effectively-once + daily caps |
| Suppression (M3) | `EMAIL#<email>` | `SUPPRESS` / `USER` | complaint/bounce hygiene + email->user pointer |

**Public snapshot contract** (`/data/fleet.json`, versioned `"v": 1`, ADR-0005):
`generated_at` + per vessel `{id, name, lat, lon, speed, heading, state[underway|docked|yard|stale], insvc, age_s, dep, arr, left, eta, eta_basis, sched, routes, pos}`.
Dims: `/data/vessels.json` (class/capacity/years), `/data/terminals.json`
(20 real + synthetic Eagle Harbor 122).

**M2 trip contracts** (all `"v": 1`, ADR-0005 extension; details in
[trip-planner.md](features/trip-planner.md)): `/data/pairs/index.json`
(38 pairs + horizon), `/data/pairs/{dep}-{arr}/{date}.json` (14-day
window, `depart_ms` = the verified fleet join key),
`/data/fares/{dep}-{arr}.json` (LineItemLookup-resolved),
`/data/alerts.json` (watermarked), `/data/adjustments.json` (season-wide
service calendar from timeadj). Pair-day files expire from the bucket
after 30 days.

**Raw archive** (`wsf-prod-raw-*`): `raw/<dataset>/dt=YYYY-MM-DD/HHMM.ndjson.gz`
partitioned by fetch-time UTC; the replayable ground truth for M4.

**M4 analytics store** (same bucket, `analytics/` prefix - derived, always
rebuildable from raw). Details and honesty rules in
[stats.md](features/stats.md).

`analytics/history/year=YYYY/part-0.parquet` - zstd, ONE file per year,
same-key overwrite (S3 PUTs are atomic and strongly consistent; a second
versioned file would double-count under partition projection). Year is the
**Pacific wall-clock service year**, so a 23:00 New Year's Eve sailing
belongs to the year the rider sailed it.

| Column | Type | Notes |
|---|---|---|
| `vessel_name` | string | the join key; VesselId in vesselhistory is corrupt |
| `departing_terminal_id` / `arriving_terminal_id` | int32 | via `wsf_core.slips`; the PRIMARY stats dimension |
| `route_id` | int32, nullable | best-effort annotation from the live pairs index |
| `service_date` | date32 | Pacific |
| `depart_hhmm_local` | string | Pacific; slot identity is (dep, arr, HH:MM) |
| `scheduled_depart` / `actual_depart` | timestamp ms | UTC-naive; null actual keeps the row with null delay |
| `delay_min` | float32 | actual - scheduled; negative means early |

No `cancelled` column: vesselhistory has no such flag, so the column could
only ever hold a hardcoded `false` published as fact. Cancellation is a
scheduled-vs-sailed reconciliation instead (`reconcile.py`, from
2026-07-29).

`analytics/quarantine/dt=.../HHMMSS.ndjson.gz` - rows that could not join,
with a reason. Current residue: 119,579 `null_slip` (2.95%, a COVID-era
cluster), **zero** `unmapped_slip`.

**Catalog**: Glue database `wsf_prod_analytics`, EXTERNAL_TABLE `history`,
partition projection `year` 2002-2035 (no crawler, no partition metadata to
drift). The location template must match the prefix byte for byte - a
mismatch returns zero rows silently. Athena workgroup
`wsf-prod-analytics` enforces the result location and a 2 GB scan cutoff.

**M4 stats contracts** (`"v": 1`): `/data/stats/summary.json` (system
windows, 24-year `by_year`, `by_month`, per-vessel table, superlatives,
coverage + thin days, cancellations) and `/data/stats/pairs/{dep}-{arr}.json`
(pair headline, `slots[]` with `basis`/`primary`/`slot_window`/`all_time`,
`seasons[]`, cancellations). Keyed by terminal ID so a rename never breaks a
file name. `/data/capacity.json` (minute-fresh, pair-keyed drive-up space +
`reporting_terminals`, so absence is distinguishable from fullness).

Scale as of 2026-07-30: **3,493,725 sailings, 2002-03-01 to 2026-07-30, 30
vessels, 25 partitions, ~46 MB Parquet**; a full nightly Athena suite scans
~237 MB (~$0.0012).

## Deploy pipeline

```mermaid
flowchart LR
    DEV([PR branch]) -- "pull_request" --> PLAN[GitHub Actions<br/>fmt / validate / tflint<br/>+ read-only plan]
    PLAN -- "OIDC: wsf-github-plan<br/>(ReadOnlyAccess)" --> AWS1[(AWS)]
    DEV -- merge --> MAIN([main])
    MAIN -- push --> APPLY[GitHub Actions<br/>re-plan + apply, serialized]
    APPLY -- "OIDC: wsf-github-apply<br/>(pinned to refs/heads/main)" --> AWS2[(AWS envs/prod)]
```

Bootstrap is applied only locally by a human - CI never manages its own
credentials or state bucket.

## Target state (decided in ADR-0001, lands M1-M4)

```mermaid
flowchart TB
    WSF[WSDOT Ferries API]

    subgraph ingest [Ingestion - M1]
        EB[EventBridge Scheduler] --> POLL[Lambda pollers]
    end

    subgraph hot [Hot path]
        DDB[(DynamoDB<br/>single-table hot state)]
    end

    subgraph cold [Analytics path]
        RAW[(S3 raw archive)]
        PQ[(S3 partitioned Parquet)]
        GLUE[Glue catalog] --> ATH[Athena]
        MAT[Nightly materialization<br/>Lambda]
    end

    subgraph serve [Serving]
        AGW2[API Gateway HTTP] --> API[Lambda API]
        CF2[CloudFront] --> WEB2[(S3 web - Next.js static)]
    end

    WSF --> POLL
    POLL --> DDB
    POLL --> RAW
    RAW --> PQ --> GLUE
    ATH --> MAT --> DDB
    API --> DDB
    COG[Cognito - M3] -.auth.-> API
    SES[SES email alerts - M3] -.-> USERS([Subscribers])
    DDB -.alert eval.-> SES
```

## ERD

- **Source data ERD** (WSDOT API, as-is): `api-exploration-wsdot-ferries/report.html`, ERD tab.
- **Product data model ERD**: lands with M1's DynamoDB single-table design and
  Parquet schemas; will live here.
