"""Ingestion service: the vessellocations poller and the dims refresher.

Architecture: ADR-0001 (lakehouse), ADR-0005 (snapshot serving). The poller
runs every minute with an internal 4x15 s loop; the dims refresher runs every
15 minutes and re-publishes dimension JSON only when the upstream
cacheflushdate changes.
"""
