# DSQL, S3 Tables, and Tile Hosting - research appendix

Produced 2026-07-24 for ADR-0001 and ADR-0003. Condensed verdicts live in
the ADRs; this preserves the detailed findings.

## Aurora DSQL unsupported/limits (from AWS docs, checked 2026-07-24)

Not supported: foreign keys (docs: "implement validation in your application
layer"), triggers, extensions (incl. PostGIS), PL/pgSQL, temp tables,
TRUNCATE, CREATE TYPE, materialized views. Supported with caveats: sequences/
identity (gaps, non-monotonic), JSON/JSONB (no GIN indexes, 1 MiB), views
(5,000 max). Isolation fixed at Repeatable Read with optimistic concurrency
(commit-time serialization errors require app retries); SELECT FOR UPDATE
only on full-PK equality. One database per cluster, C collation, UTC.
Auth: IAM tokens only (15-min default expiry), max connection 60 min,
10k connections/cluster. Transactions: 3,000 rows / 10 MiB / 5 min / 1 DDL.
Pricing: $8/M DPU + $0.33/GB-mo; free tier 100k DPU + 1 GB-mo monthly.

Sources: docs.aws.amazon.com/aurora-dsql/latest/userguide/
{working-with-postgresql-compatibility-unsupported-features,
working-with-postgresql-compatibility-supported-sql-features,
create-table-syntax-support,
working-with-postgresql-compatibility-supported-data-types, CHAP_quotas,
authentication-authorization, SECTION_authentication-token}.html;
aws.amazon.com/rds/aurora/dsql/pricing; engineering.dena.com/blog/2025/07/
aurora-dsql_01_aurora_en (extension corroboration).

## S3 Tables at 0.2-2 GB scale

Components: storage $0.0265/GB-mo (+15%), monitoring $0.025/1k objects-mo,
compaction $0.002/1k objects + $0.005/GB (prices cut 2025-07-01). At our
scale: ~$0.10-0.20/mo vs ~$0.06-0.10 for plain Parquet + free-tier nightly
compaction Lambda. Decisive difference: table buckets forbid direct object
access (Iceberg interfaces only) - incompatible with the raw-archive-as-
ground-truth requirement. Sources: aws.amazon.com/s3/pricing;
docs.aws.amazon.com/AmazonS3/latest/userguide/{s3-tables-buckets,
s3-tables-access}.html; the 2025-07-01 compaction price-cut what's-new post.

## Tile hosting

OpenFreeMap: unlimited views, no keys, commercial use allowed, OSM
attribution required, explicitly no SLA; single maintainer, donation-funded;
entire stack self-hostable. Sources: openfreemap.org;
github.com/hyperknot/openfreemap.

Protomaps self-host: `pmtiles extract` from daily planet build (z0-15 planet
~120 GB; US+Mexico measured 17 GB; WA bbox estimated 0.5-2 GB - our estimate,
labeled). AWS pattern: PMTiles in S3 + Lambda range-request translator +
CloudFront (documented ~125 ms p50 / 800 ms p99). Cost: ~$0/mo at 100 DAU
inside always-free CloudFront; ~$2/mo pricing a 5k-DAU spike with no free
tier. Glyphs/sprites are plain static files in both ecosystems. Sources:
docs.protomaps.com/{basemaps/downloads,pmtiles/cli,deploy/aws};
github.com/protomaps/go-pmtiles/issues/68; aws.amazon.com/cloudfront/pricing.
