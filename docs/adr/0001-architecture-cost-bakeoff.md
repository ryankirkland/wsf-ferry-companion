# ADR-0001: Backend architecture under the $15 idle ceiling

- **Status:** Proposed (bake-off to be completed in Phase C - do not build against either option yet)
- **Context:** The PRD binds idle cost to <$15/month while demanding public-launch robustness and pure-play AWS. Those constraints already eliminate ALB-fronted always-on compute (~$16-18/mo fixed), NAT gateways (~$32/mo), and Aurora Serverless v2 (~$44/mo floor at 0.5 ACU). Two viable shapes remain; this ADR decides between them with verified pricing and a thin proof of each critical path.

## Constraints (from PRD section 7)

- Idle <$15/mo total; scale with usage, not with idleness.
- Must serve: ~5-15 s polling ingestion, realtime map reads, 14-year analytical queries, alert fan-out, Cognito-backed auth.
- Terraform-managed; no fixed-cost load balancers or NAT.

## Option A: Serverless lakehouse (~$3-8/mo idle, estimates to verify)

Lambda pollers (EventBridge 1-min rules, internal sub-minute loops) -> DynamoDB for hot state (current fleet, active alerts, upcoming departures) + S3 raw archive -> Parquet on S3 with Athena for the historical/stats layer (nightly compaction) -> Lambda + API Gateway HTTP API -> CloudFront + Next.js (static/SSG with client-side live data) -> Cognito, SES, SNS.

- For: scales to zero; every component pay-per-use; modern lakehouse resume story; no VPC networking costs at all.
- Against: no Postgres story; stats queries move to Athena (per-query latency + $5/TB scanned); two data models (Dynamo + Parquet) to keep coherent.

## Option B: Minimal Postgres core (~$18-25/mo idle, estimates to verify)

RDS Postgres db.t4g.micro single-AZ (~$13-15/mo incl. storage) as the one warehouse (medallion schemas) + the same Lambda pollers/API + Amplify or CloudFront hosting.

- For: one relational home for everything; conventional and simple; SQL transforms trivially expressible.
- Against: breaches the ceiling as stated (requires an explicit PRD exception); single-AZ micro instance is the least "public launch" shaped component; VPC networking care needed to avoid NAT costs.

## Bake-off protocol (Phase C)

1. Verify current us-west-2 pricing for every line item (no estimates in the final table).
2. Thin spike of each critical path: (A) Athena p95 latency on a synthetic 5M-row sailing history + Dynamo read path for the map; (B) t4g.micro under combined poller writes + map reads.
3. Model three load points: idle, 100 DAU, 5k DAU spike; produce the cost table for each.
4. Decide, record consequences, supersede this stub's open questions.

## Decision

Pending Phase C.
