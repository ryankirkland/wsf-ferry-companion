# Architecture

Living document - updated every time deployed infrastructure changes
(CLAUDE.md mandate). Decisions behind the shapes: [ADR-0001](adr/0001-architecture-cost-bakeoff.md)
(serverless lakehouse), [ADR-0003](adr/0003-tile-hosting.md) (tiles),
[ADR-0004](adr/0004-state-backend-and-ci.md) (state + CI).

## Deployed today (M0 walking skeleton)

```mermaid
flowchart LR
    U([Rider's browser])

    subgraph edge [Global edge]
        R53[Route53<br/>ferrysound.com zone]
        CF[CloudFront]
    end

    subgraph usw2 [AWS us-west-2]
        WEB[(S3 web bucket<br/>coming-soon page)]
        ASSETS[(S3 map-assets bucket<br/>glyphs and sprites, M1)]
        AGW[API Gateway HTTP<br/>api.ferrysound.com]
        HELLO[Lambda hello<br/>python3.12 arm64]
    end

    U -- HTTPS --> CF
    CF -- default --> WEB
    CF -- "/assets/*" --> ASSETS
    U -- HTTPS --> AGW --> HELLO
    R53 -.aliases.-> CF
    R53 -.aliases.-> AGW
```

Account-level (bootstrap stack): Terraform state bucket with native lockfile,
GitHub OIDC provider, plan/apply CI roles, $15 budget with three email
notifications.

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
