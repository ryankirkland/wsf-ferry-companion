"""M4 analytics pipeline (ADR-0001, docs/features/stats.md).

- sync:      nightly vesselhistory collector + one-shot backfill mode (D1)
- capacity:  1-minute terminalsailingspace raw poller (D1)
- transform: raw -> year-partitioned Parquet (D2)
- stats:     Athena -> /data/stats contracts (D3)
"""
