# Architecture

Living document - updated every time deployed infrastructure changes
(CLAUDE.md mandate). Decisions behind the shapes: [ADR-0001](adr/0001-architecture-cost-bakeoff.md)
(serverless lakehouse), [ADR-0003](adr/0003-tile-hosting.md) (tiles),
[ADR-0004](adr/0004-state-backend-and-ci.md) (state + CI).

## Deployed today (M0 skeleton + M1 data path + M1 web)

```mermaid
flowchart LR
    WSF[WSDOT Ferries API]
    U([Rider's browser])

    subgraph ingest [Ingestion - live]
        EB[EventBridge Scheduler<br/>1 min + 15 min] --> POLL[Lambda poller<br/>4x15s loop]
        EB --> DIMS[Lambda dims refresher<br/>cacheflushdate-gated]
    end

    subgraph usw2 [AWS us-west-2]
        DDB[(DynamoDB wsf-prod-hot<br/>FLEET + META items)]
        RAW[(S3 raw archive<br/>gzipped NDJSON by fetch-time)]
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
    POLL --> DDB
    POLL --> RAW
    POLL -- every poll --> DATA
    DIMS --> DATA
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
`/ambient` wall mode with wake lock + daily reload. Deploys via
`web-deploy.yml` two-pass sync + invalidation. Tiles come from the
OpenFreeMap public instance; the PMTiles fallback behind `/tiles/*` is the
tested escape hatch (ADR-0003 as amended).

Alarms: poller-gap (the SLO alarm), auth-failure (400+Message canary),
empty-fleet, two Lambda-error alarms - all to the `wsf-prod-alarms` SNS
topic. Account-level (bootstrap stack): Terraform state bucket with native
lockfile, GitHub OIDC provider, plan/apply CI roles, $15 budget with three
email notifications.

## Product data model (ERD start - grows with each milestone)

**DynamoDB `wsf-prod-hot`** (single table, generic PK/SK, on-demand):

| Item | PK | SK | Content |
|---|---|---|---|
| Fleet position (21) | `FLEET` | `VESSEL#0038` (zero-padded VesselID) | name, lat/lon/speed/heading (N), at_dock, in_service, state, terminals, eta/left/sched ISO strings, source_ts, fetched_at |
| Poll health | `META` | `POLLER#vessellocations` | last_success/attempt, polls ok/failed, last_error |
| Dim refresh tokens | `META` | `CACHEFLUSH#vessels\|terminals` | opaque cacheflushdate token |
| M2 departures (planned) | `PAIR#0007#0003` | `DEP#<iso>` | TTL via `expires_at` |
| M3 alerts (planned) | `ALERTS` / `USER#<sub>` | `BULLETIN#` / `SUB#<route>` | Streams fan-out |

**Public snapshot contract** (`/data/fleet.json`, versioned `"v": 1`, ADR-0005):
`generated_at` + per vessel `{id, name, lat, lon, speed, heading, state[underway|docked|yard|stale], insvc, age_s, dep, arr, left, eta, eta_basis, sched, routes, pos}`.
Dims: `/data/vessels.json` (class/capacity/years), `/data/terminals.json`
(20 real + synthetic Eagle Harbor 122).

**Raw archive** (`wsf-prod-raw-*`): `raw/<dataset>/dt=YYYY-MM-DD/HHMM.ndjson.gz`
partitioned by fetch-time UTC; the replayable ground truth for M4.

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
