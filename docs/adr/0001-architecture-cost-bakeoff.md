# ADR-0001: Backend architecture under the $15 idle ceiling

- **Status:** Proposed (bake-off to be completed in Phase C - do not build against any option yet)
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

## Wildcards to evaluate (not defaults)

- **S3 Tables (managed Apache Iceberg):** strengthens Option A - AWS-managed Iceberg with automatic compaction, queryable from Athena; removes A's small-files chore and modernizes the story further. Evaluate cost overhead vs plain Parquet + self-managed compaction.
- **Aurora DSQL (serverless Postgres-compatible, scale-to-zero):** the "tables AND scale-to-zero" middle path. Compatibility is a subset - notably no foreign keys, no extensions - which removes much of Option B's actual appeal. Include in the bake-off long enough to embrace or dismiss with verified pricing and limits.

## Comparison at a glance (estimates until Phase C verifies)

| | A: Lakehouse | B: Postgres core |
|---|---|---|
| Idle cost | ~$3-8/mo | ~$18-25/mo (+~$11 RDS Proxy if needed) |
| Spike behavior | Absorbs, pay-per-use | Pooling gymnastics, vertical scaling |
| Integrity enforcement | Pipeline + tests + quarantine | Database constraints |
| Ad-hoc exploration | Athena (seconds, per-query cost) | psql (instant, free) |
| Ops burden | Wiring, IAM, compaction | Patching, backups, VPC, connections |
| AWS skills exercised | DynamoDB, S3/Parquet, Glue, Athena, EventBridge, CloudFront | RDS, VPC networking, pooling |
| Resume story | Store-per-workload lakehouse on primitives | Boring-tech discipline |

## Bake-off protocol (Phase C)

1. Verify current us-west-2 pricing for every line item above, including S3 Tables and DSQL (no estimates in the final table).
2. Thin spikes of the critical paths:
   - A: Athena p95 latency + cost on a synthetic 5M-row sailing history; DynamoDB single-table design for map + trip-planner reads; end-to-end poller -> Dynamo -> page freshness.
   - B: t4g.micro under combined poller writes + map reads with Lambda concurrency; connection behavior with and without RDS Proxy.
   - DSQL: schema compatibility check against our model (the no-FK limitation) + idle/load cost measurement.
3. Model three load points: idle, 100 DAU, 5k DAU spike day; produce the cost table for each.
4. Decide; record consequences (including the integrity-testing obligations if A wins, or the PRD ceiling exception if B wins); supersede this stub.

## Decision

Pending Phase C.
