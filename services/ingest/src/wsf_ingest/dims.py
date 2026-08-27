"""Dims refresher Lambda: republish dimension JSON only when content changes.

Runs every 15 minutes. Two gates, cheapest first:

1. Token gate: compare the vessels/terminals cacheflushdate tokens (bare
   .NET date strings, treated as opaque) against META items. Unchanged
   token -> skip without fetching the dimension at all.
2. Content gate: on a token change, rebuild the served payload and compare
   its sha256 against the last published one. WSDOT flips the terminals
   token on essentially every poll while the content stays identical
   (observed ~96 flips/day through Aug 2026, which burned the CloudFront
   invalidation free tier and then ~$0.50/day); an identical hash absorbs
   the churn - store the new token, publish nothing, invalidate nothing.

Only a genuine content change (or {"mode": "force-rebuild"}) publishes
/data/{vessels,terminals}.json, archives the raw payload, and invalidates
the CloudFront path.

The one-off Gate-2 benchmark lived here until 2026-08-24. It measured
read latency against the FLEET#/VESSEL# rows to confirm ADR-0001's
serving-read gate; those rows are retired (ADR-0005, amended) and the
server-side read path it was validating was never built - the map reads
the snapshot from CloudFront.
"""

import hashlib
import json
import os
import time
from datetime import UTC, datetime

import boto3
from wsf_core import EAGLE_HARBOR_TERMINAL, WsfClient
from wsf_core.ssm import get_access_code

from wsf_ingest.archive import archive_dim
from wsf_ingest.metrics import emit

META_PK = "META"

_client: WsfClient | None = None


def _wsf() -> WsfClient:
    global _client
    if _client is None:
        _client = WsfClient(get_access_code())
    return _client


def _table():
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])


def _stored_meta(table, sub_api: str) -> tuple[str | None, str | None]:
    item = table.get_item(Key={"PK": META_PK, "SK": f"CACHEFLUSH#{sub_api}"}).get("Item", {})
    return item.get("token"), item.get("content_sha256")


def _store_meta(table, sub_api: str, token: str, content_sha256: str) -> None:
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": f"CACHEFLUSH#{sub_api}",
            "token": token,
            "content_sha256": content_sha256,
            "updated_at_utc": datetime.now(UTC).isoformat(),
        }
    )


def _canonical(payload: object) -> bytes:
    """The exact bytes we publish - hashed so the content gate and the
    published object can never disagree."""
    return json.dumps(payload, separators=(",", ":")).encode()


def _put_data(s3, key: str, body: bytes) -> None:
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=300",
    )


def _build_vessels(client: WsfClient) -> dict:
    # sorted for a deterministic hash - upstream ordering is not contractual
    dims = sorted(client.vessel_dims(), key=lambda d: d.vessel_id)
    return {
        "v": 1,
        "vessels": [
            {
                "id": d.vessel_id,
                "name": d.vessel_name,
                "abbrev": d.vessel_abbrev,
                "class": d.class_name,
                # WSDOT's official class drawing, mirrored into the
                # assets bucket by tools/vessel-drawings. Published
                # even if a new class has not been mirrored yet - the
                # card hides a drawing that fails to load.
                "drawing": f"/assets/vessels/{d.class_slug}.png" if d.class_slug else None,
                "silhouette": d.silhouette_url,
                "max_passengers": d.max_passengers,
                "reg_deck_space": d.reg_deck_space,
                "tall_deck_space": d.tall_deck_space,
                "year_built": d.year_built,
                "year_rebuilt": d.year_rebuilt,
                "length": d.length_text,
            }
            for d in dims
        ],
    }


def _build_terminals(client: WsfClient) -> dict:
    terms = [*client.terminal_locations(), EAGLE_HARBOR_TERMINAL]
    return {
        "v": 1,
        "terminals": [
            {
                "id": t.terminal_id,
                "name": t.terminal_name,
                "abbrev": t.terminal_abbrev,
                "lat": t.lat,
                "lon": t.lon,
                "synthetic": t.synthetic,
            }
            for t in sorted(terms, key=lambda t: t.terminal_id)
        ],
    }


# Which cacheflushdate token governs which publications:
# sub_api -> (build fn, raw fetcher name, raw dataset name, served path)
_DATASETS = {
    "vessels": (_build_vessels, "vessel_dims_raw", "vesselverbose", "/data/vessels.json"),
    "terminals": (
        _build_terminals,
        "terminal_locations_raw",
        "terminallocations",
        "/data/terminals.json",
    ),
}


def lambda_handler(event, context):

    # {"mode": "force-rebuild"} republishes regardless of the token - the
    # operational lever for shipping a CONTRACT change (a new field) when
    # upstream has no reason to flush its cache. Same lever the schedule
    # refresher carries.
    force = isinstance(event, dict) and event.get("mode") == "force-rebuild"

    client, table, s3 = _wsf(), _table(), boto3.client("s3")
    refreshed: list[str] = []
    token_churn = 0
    for sub_api, (build, raw_fetcher, raw_name, path) in _DATASETS.items():
        token = client.cache_flush_date(sub_api)
        stored_token, stored_sha = _stored_meta(table, sub_api)
        if token == stored_token and not force:
            continue

        body = _canonical(build(client))
        sha = hashlib.sha256(body).hexdigest()
        if sha == stored_sha and not force:
            # Upstream flushed its cache but the served content is identical.
            # Store the new token so the next run takes the cheap gate, and
            # publish/invalidate nothing.
            _store_meta(table, sub_api, token, sha)
            token_churn += 1
            continue

        _put_data(s3, path.lstrip("/"), body)
        archive_dim(s3, os.environ["RAW_BUCKET"], raw_name, getattr(client, raw_fetcher)(), token)
        _store_meta(table, sub_api, token, sha)
        refreshed.append(path)

    if refreshed and (dist := os.environ.get("DISTRIBUTION_ID")):
        boto3.client("cloudfront").create_invalidation(
            DistributionId=dist,
            InvalidationBatch={
                "Paths": {"Quantity": len(refreshed), "Items": refreshed},
                "CallerReference": f"dims-{int(time.time())}",
            },
        )

    emit(DimsRefreshed=len(refreshed), DimsTokenChurn=token_churn)
    return {"refreshed": refreshed, "token_churn": token_churn}
