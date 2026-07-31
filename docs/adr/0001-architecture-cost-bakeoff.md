# ADR-0001: Backend architecture under the $15 idle ceiling

- **Status:** Accepted (2026-07-28) - Option A, the serverless lakehouse; see Decision below
- **Context:** The PRD binds idle cost to <$15/month while demanding public-launch robustness and pure-play AWS. Those constraints already eliminate ALB-fronted always-on compute (~$16-18/mo fixed), NAT gateways (~$32/mo), and Aurora Serverless v2 (~$44/mo floor at 0.5 ACU). This ADR decides the data/compute shape with verified pricing and thin proofs of each critical path.

## Constraints (from PRD section 7)

- Idle <$15/mo total; cost scales with usage, not with idleness.
- Must serve: 5-15 s polling ingestion, realtime map reads for potentially thousands of concurrent viewers, 24-year analytical history (backfill verified to 2002-03), alert fan-out, Cognito-backed auth.
- Terraform-managed; no fixed-cost load balancers or NAT.

## The framing: three workloads, not one database question

1. **Hot state (tiny, read-hot):** current fleet positions (~21 rows), active alerts, next departures per terminal pair. Written every poll cycle, read by every viewer.
2. **Append-only history (large):** position snapshots, sailing history (millions of rows), capacity snapshots. Written constantly, read for analytics.
3. **Serving aggregates:** on-time percentages, delay percentiles, cancellation rates - computed from #2 on a schedule, read by stats pages.

The options differ in whether one engine serves all three or each workload gets a purpose-built store.

## Option A: Serverless lakehouse (~$3-8/mo idle, verify in Phase C)

Lambda pollers (EventBridge 1-min rules, internal sub-minute loops) -> DynamoDB for hot state + S3 raw archive -> partitioned Parquet with a Glue catalog queried by Athena for history -> scheduled jobs precompute aggregates INTO DynamoDB or static JSON behind CloudFront (user requests never wait on Athena) -> Lambda + API Gateway HTTP API -> CloudFront + Next.js -> Cognito, SES, SNS.

**Why it fits this product**
- Note the correction to the intuitive objection: A still has tables and SQL - Athena tables over Parquet are real SQL tables (Trino engine). What A gives up is one specific kind: transactional, indexed, foreign-keyed, always-on relational tables.
- Scales to zero and absorbs spikes without intervention: DynamoDB + CloudFront serve thousands of simultaneous map viewers; this is the public-launch ambition and the cost ceiling satisfied by the same design.
- Zero-ops: nothing to patch, back up, or resize.
- The S3 raw archive that the lakehouse requires is also the mitigation for the project's riskiest dependency (undocumented vesselhistory).
- Portfolio articulation: separation of storage and compute is the defining idea of modern data platforms (Iceberg/Delta/Trino lineage); demonstrating it on raw AWS primitives, with store-per-access-pattern reasoning, is the stronger story.

**Honest costs**
- Referential integrity moves from database constraints into tested pipeline code + quarantine tables. Given this API's identity quirks, those tests are needed regardless, but the discipline is now load-bearing.
- DynamoDB is access-pattern-first: queries must be known up front; no ad-hoc joins in the hot path.
- Athena: seconds of latency, $5/TB scanned, no row updates (partition rewrites), small-files compaction needed. Strictly for scheduled/ad-hoc work.
- More wiring: more Terraform, more IAM edges, more distributed failure modes (each part managed, the seams ours).

## Option B: Minimal Postgres core (~$18-25/mo idle, verify in Phase C)

RDS Postgres db.t4g.micro single-AZ (~$13-15/mo incl. storage) as the one warehouse (medallion schemas) + the same Lambda pollers/API + CloudFront/Amplify hosting.

**Steelman**
- One system, one truth: FKs catch identity garbage at write time, transforms are plain SQL in one place, ad-hoc exploration is instant and free (psql). Best development velocity and debuggability; at this data volume Postgres is effortless.
- "Right-sized boring technology" is itself a respectable engineering story.

**Why it struggles here specifically**
- Breaches the ceiling as stated (explicit PRD exception required).
- Single-AZ micro contradicts the public-launch posture; Lambda fan-out exhausts ~85 connections fast (RDS Proxy fixes it for another ~$11/mo).
- VPC networking care required; the classic failure (NAT gateway) costs more than the database.
- Teaches RDS/VPC (valuable, conventional) but exercises less of the AWS-native data stack.

## Wildcards - verified findings (Stage 1, checked 2026-07-24)

- **Aurora DSQL - leaning dismiss, spike confirms.** Docs verify: no foreign
  keys ("implement validation in your application layer"), no triggers, no
  extensions (including PostGIS), no PL/pgSQL, no temp tables, no TRUNCATE;
  isolation fixed at Repeatable Read with optimistic concurrency (commit-time
  retry logic required); IAM-token-only auth (15-min tokens) with 60-minute
  max connection lifetime; transactions capped at 3,000 rows / 10 MiB / 5 min
  (the history backfill would need chunked writes). Free tier: 100k DPUs +
  1 GB-month ongoing; paid $8/1M DPUs + $0.33/GB-mo. It removes precisely the
  things (FK integrity, conventional psql ergonomics) that made "tables"
  attractive here. Sources: AWS DSQL docs (unsupported features, supported
  SQL, quotas, auth, pricing pages).
- **S3 Tables - dismiss at this scale.** At 0.2-2 GB with ~100 files/day,
  total overhead is ~$0.10-0.20/mo vs ~$0.06-0.10 for plain Parquet plus a
  free-tier nightly compaction Lambda - cost is noise below ~100 GB. The real
  cost is architectural: table buckets forbid direct object access (Iceberg
  interfaces only), which conflicts with this project's raw-archive-as-ground-
  truth principle (the S3 archive doubles as the recovery path for the
  undocumented vesselhistory endpoint and must stay trivially readable).
  Plain S3 Parquet + DIY compaction wins; revisit only if the dataset grows
  100x. Sources: S3 pricing page (table-bucket section), S3 Tables access-
  model docs, 2025-07-01 compaction price-cut announcement.

Tile hosting findings moved to [ADR-0003](0003-tile-hosting.md) (recommend:
launch on OpenFreeMap, self-host glyphs/sprites now and a tested PMTiles
fallback from M1).

## Comparison at a glance (costs verified 2026-07-24; latency pending spikes)

| | A: Lakehouse | B: Postgres core |
|---|---|---|
| Idle cost (verified) | **$2.02/mo** | **$14.97/mo** (+**$21.90/mo** if RDS Proxy needed) |
| Spike behavior | Absorbs, pay-per-use | Pooling gymnastics, vertical scaling |
| Integrity enforcement | Pipeline + tests + quarantine | Database constraints |
| Ad-hoc exploration | Athena (seconds, per-query cost) | psql (instant, free) |
| Ops burden | Wiring, IAM, compaction | Patching, backups, VPC, connections |
| AWS skills exercised | DynamoDB, S3/Parquet, Glue, Athena, EventBridge, CloudFront | RDS, VPC networking, pooling |
| Resume story | Store-per-workload lakehouse on primitives | Boring-tech discipline |

## Verified pricing and scenario models (Stage 1, checked 2026-07-24)

Every number below comes from the AWS Price List bulk API for us-west-2,
cross-checked against the marketing pages, on 2026-07-24. Shared usage model:
4 pollers x 43,200 invocations/mo at 2 s / 256 MB, ~1.53M ingest+history
writes/mo, reads 1k/day idle -> 50k/day at 100 DAU -> one 2.5M-read spike day
(CloudFront absorbing 85% on the spike), always-free tiers applied, 12-month
promotional tiers NOT applied.

**Option A - serverless lakehouse (Lambda, API GW HTTP, DynamoDB on-demand, S3 + Athena/Glue, CloudFront, Cognito, SES):**

| Scenario | Verified monthly cost | Dominant lines |
|---|---|---|
| Idle | **$2.02** | DynamoDB writes $0.96 · S3 PUTs $0.95 |
| 100 DAU | **$4.00** | + API GW $1.50 |
| 100 DAU + 5k spike day | **$4.99** | + API GW/reads/SES |

**Option B - Postgres core (same edges, RDS db.t4g.micro single-AZ + 20 GB gp3 instead of DynamoDB/Athena):**

| Scenario | No Proxy | With RDS Proxy |
|---|---|---|
| Idle | **$14.97** | $36.87 |
| 100 DAU | $16.86 | $38.76 |
| 100 DAU + spike day | $17.82 | $39.72 |

Cost verdicts against Gate 1 (<= $15 idle): **A passes with 7x headroom; B
without Proxy grazes under at $14.97 and exceeds the ceiling at any real
usage; B with Proxy is disqualified outright** - and the 04 spike's
50-connection probe measures exactly whether B can live without the Proxy.

**Corrections worth remembering** (full citations in the research appendix):
- RDS t4g.micro is $0.016/hr = $11.68/mo (not the oft-quoted ~$12.3).
- DynamoDB on-demand reflects the 2024 price cut: $0.625/M writes, $0.125/M reads.
- RDS Proxy has a 2-vCPU minimum: the proxy costs 1.9x the t4g.micro it fronts.
- Athena is exactly $5.00/TB; our nightly transforms compute to ~$0.07/mo.
- DSQL's free tier is real and monthly-recurring (100k DPU + 1 GB-mo) - the
  dismissal above rests on functionality, not price.
- **US SMS reality check for M3:** ~$0.0120 per message part, and 10DLC carries
  ~$11/mo fixed (campaign $10 + number $1) plus ~$67 one-time fees. A
  **toll-free number is $2/mo** with the same per-message price - the M3
  default should be toll-free unless volume dictates otherwise, or SMS alone
  nearly doubles Option A's idle bill.
- The AWS Free Tier program changed 2025-07-15; always-free allowances
  (Lambda 1M/400k GB-s, DynamoDB 25 GB, CloudFront 1 TB, CloudWatch, Cognito
  10k MAU) survive on both new-account plans; the CloudWatch line would be
  $4.10/mo gross if free-tier assumptions ever break.

## Bake-off protocol (Phase C)

1. Verify current us-west-2 pricing for every line item above, including S3 Tables and DSQL (no estimates in the final table).
2. Thin spikes of the critical paths:
   - A: Athena p95 latency + cost on a synthetic 5M-row sailing history; DynamoDB single-table design for map + trip-planner reads; end-to-end poller -> Dynamo -> page freshness.
   - B: t4g.micro under combined poller writes + map reads with Lambda concurrency; connection behavior with and without RDS Proxy.
   - DSQL: schema compatibility check against our model (the no-FK limitation) + idle/load cost measurement.
3. Model three load points: idle, 100 DAU, 5k DAU spike day; produce the cost table for each.
4. Decide; record consequences (including the integrity-testing obligations if A wins, or the PRD ceiling exception if B wins); supersede this stub.

## Measurements (Stage 2, run 2026-07-28; scripts in `spikes/`, raw JSON in `spikes/results/`)

Dataset: the synthetic 5,113,360-row sailing history (2002-2026), year-partitioned zstd Parquet, 62.3 MB, partition projection enabled.

**Athena** (6 canonical queries x3 runs):

| Query | Engine p50 | Total p95 | Scanned | $ per run |
|---|---|---|---|---|
| daily on-time, 14d window | 614 ms | 844 ms | 0.27 MB | $0.000001 |
| full-history route percentiles | 1,154 ms | 1,400 ms | 6.72 MB | $0.000034 |
| per-vessel season rollup | 841 ms | 1,155 ms | 6.75 MB | $0.000034 |
| monthly cancellation rates | 1,253 ms | 1,720 ms | 27.82 MB | $0.000139 |
| worst-100 delays all-time | 1,285 ms | 1,585 ms | 6.84 MB | $0.000034 |
| point lookup (route+date) | 452 ms | 1,179 ms | 2.49 MB | $0.000012 |

**DynamoDB** (single-table hot state; 1,000 GetItem + 500 Query, measured from a laptop over the public internet - WAN round trip included; in-region will be lower): GetItem p50/p95 = 30.8/47.3 ms; Query p50/p95 = 30.7/46.9 ms.

**Gate-2 in-region confirmation (M1, 2026-07-29):** the same read patterns re-run from a Lambda in us-west-2 against the production `wsf-prod-hot` table (`wsf-prod-ingest-dims`, event `{"mode": "gate2-bench"}`): GetItem p50/p95 = 17.0/20.1 ms; Query p50/p95 = 20.0/20.2 ms (n = 1,000/500). The 200 ms gate holds with 10x margin; the consequence recorded at acceptance is closed.

**RDS db.t4g.micro** (same 5.1M rows, COPY load 112 s; no secondary indexes built - the point-lookup row is therefore unfair to Postgres, the analytical rows are structural): same six queries p50 = 2,650 / 10,018 / 2,238 / 2,675 / 1,764 / 1,873 ms. **Concurrency probe: 50 parallel connections, 0 errors, p50 42.7 s, p95 42.8 s** - the instance queues Lambda-style fan-out into unusability rather than failing loudly.

**Aurora DSQL probe** (live confirmation of the Stage 1 dismissal): FK DDL rejected verbatim - `FeatureNotSupported: FOREIGN KEY constraint not supported` - and the first 100k-row bulk insert tripped `ProgramLimitExceeded: transaction row limit exceeded` (the 3,000-row cap), which alone rules out our backfill pattern. Cluster created and deleted cleanly within the timebox.

## Gates applied (mechanically, per the pre-registration)

| Gate | Option A | Option B |
|---|---|---|
| 1. Idle <= $15/mo | **PASS** ($2.02, 7x headroom) | Marginal at $14.97; **FAIL** with the Proxy ($36.87) its fan-out problem requires |
| 2. Serving reads p95 <= 200 ms | **PASS** (47 ms incl. WAN; in-region lower) | **FAIL** (42,787 ms under 50-way fan-out) |
| 3. Ad-hoc analytics p95 <= 10 s | **PASS** (worst 1.72 s) | **FAIL** (marginal: 10.0 s p50 on full-history percentiles) |
| 4. Transforms <= $1/mo | **PASS** (nightly suite ~$0.01/mo) | PASS (in-database) |
| 5. Zero always-on; absorbs spike day | **PASS** | FAIL (always-on instance; fan-out queues) |
| 6. Tie-break | not needed | - |

## Decision

**Option A - the serverless lakehouse - is adopted.** Lambda + EventBridge for ingestion, DynamoDB (single-table, on-demand) for hot state, S3 raw JSON archive as source of truth, year-partitioned Parquet + Glue catalog + Athena for the analytical layer, nightly materialization of aggregates into DynamoDB/static JSON, API Gateway HTTP API + CloudFront serving, Cognito/SES for auth and email.

Wildcards, closed with live evidence: **Aurora DSQL dismissed** (FK rejection and transaction-cap errors captured above; IAM-token auth and 60-minute connections additionally break conventional ergonomics). **S3 Tables dismissed at this scale** (cost delta is noise; losing direct object access conflicts with the raw-archive-as-ground-truth principle). Plain Parquet + a free-tier nightly compaction Lambda instead.

Consequences accepted:
- Referential integrity lives in pipeline code: seed mapping tables, quarantine with alarmed review + replay, idempotent writes on natural keys, and data-quality expectation checks (M4) for confident-wrongness detection.
- DynamoDB table designs are access-pattern-first and get documented per feature (the M3 alerts design is already sketched: alerts by route+time, subscriptions by route, DynamoDB Streams for notification fan-out).
- In-region latency confirmation for Gate 2 runs from the first deployed Lambda in M0 (expected to only improve on the WAN numbers).
- The ~$13/month of ceiling headroom funds SMS (toll-free), growth, and the self-hosted tile fallback (ADR-0003) without renegotiation.

## Amendment (2026-07-30, M4 build)

The decision stands; three shapes were refined once the real 3.5M-row corpus
replaced the synthetic one:

1. **Terminal pair is the primary analytical dimension**, `route_id` a
   nullable best-effort annotation. The Sidney B.C. route ran 2002-2019 and
   has no live route row; requiring route_id would have quarantined 17 years
   of real sailings forever. Retired terminals carry synthetic dim ids, the
   same precedent as Eagle Harbor 122.
2. **One Parquet file per year partition, same-key overwrite.** S3 PUTs are
   atomic and strongly consistent, so a rewrite is safe; a versioned second
   file would silently double-count under partition projection, which reads
   whatever is at the prefix.
3. **The `cancelled` column is dropped** (spike query q4 with it). The feed
   reports departures that happened and has no cancelled flag, so the column
   could only ever hold a hardcoded `false` served as fact. Cancellation is
   measured instead by reconciling each day's archived published schedule
   against reported sailings, tracked from 2026-07-29 and labeled as a floor.

Measured against the spike's projections: 3,493,725 rows over 25 year
partitions compress to ~46 MB, and the full nightly Athena suite scans
~237 MB (~$0.0012 per run, ~$0.04/mo) - comfortably inside the modeled
envelope.

## Appendix: run evidence

- Total estimated spike spend: **$0.26** of the $5 cap (tracker: `spikes/.spend.json`); next-day billing sanity check to confirm.
- Environment notes: the account had no default VPC (fresh account); a standard default VPC was recreated to host the RDS spike - free, persists, and becomes Terraform-managed context in M0. `aws login` produces a named profile (`ryan`) requiring `AWS_PROFILE` and `botocore[crt]` for SDK use.
- Teardown VERIFY EMPTY output:

```
=== VERIFY EMPTY (2026-07-28) ===
  s3 buckets wsf-spike*: EMPTY
  dynamo tables: EMPTY
  rds instances: EMPTY
  athena workgroups: EMPTY
  dsql clusters (tagged): EMPTY
TEARDOWN COMPLETE
```
(The lone teardown warning, `rds: InvalidDBInstanceStateFault`, was the delete
request finding the instance already mid-deletion from the bench script's own
cleanup; the verify listing above confirms it finished.)
