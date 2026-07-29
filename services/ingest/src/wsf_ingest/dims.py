"""Dims refresher Lambda: republish dimension JSON only when upstream flushes.

Runs every 15 minutes. Each run compares the vessels/terminals cacheflushdate
tokens (bare .NET date strings, treated as opaque) against META items; on
change it re-fetches the dimension, publishes /data/{vessels,terminals}.json,
archives the raw payload, and invalidates the two CloudFront paths.

Also carries the one-off Gate-2 benchmark (event {"mode": "gate2-bench"}):
the in-region confirmation of ADR-0001's serving-read gate, run from the
same runtime class that will serve M2 reads.
"""

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


def _stored_token(table, sub_api: str) -> str | None:
    resp = table.get_item(Key={"PK": META_PK, "SK": f"CACHEFLUSH#{sub_api}"})
    return resp.get("Item", {}).get("token")


def _store_token(table, sub_api: str, token: str) -> None:
    table.put_item(
        Item={
            "PK": META_PK,
            "SK": f"CACHEFLUSH#{sub_api}",
            "token": token,
            "updated_at_utc": datetime.now(UTC).isoformat(),
        }
    )


def _put_data(s3, key: str, payload: object) -> None:
    s3.put_object(
        Bucket=os.environ["DATA_BUCKET"],
        Key=key,
        Body=json.dumps(payload, separators=(",", ":")).encode(),
        ContentType="application/json",
        CacheControl="public, max-age=300",
    )


def _publish_vessels(s3, client: WsfClient) -> None:
    dims = client.vessel_dims()
    _put_data(
        s3,
        "data/vessels.json",
        {
            "v": 1,
            "vessels": [
                {
                    "id": d.vessel_id,
                    "name": d.vessel_name,
                    "abbrev": d.vessel_abbrev,
                    "class": d.class_name,
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
        },
    )


def _publish_terminals(s3, client: WsfClient) -> None:
    terms = [*client.terminal_locations(), EAGLE_HARBOR_TERMINAL]
    _put_data(
        s3,
        "data/terminals.json",
        {
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
        },
    )


# Which cacheflushdate token governs which publications:
# sub_api -> (publish fn, raw fetcher name, raw dataset name, served path)
_DATASETS = {
    "vessels": (_publish_vessels, "vessel_dims_raw", "vesselverbose", "/data/vessels.json"),
    "terminals": (
        _publish_terminals,
        "terminal_locations_raw",
        "terminallocations",
        "/data/terminals.json",
    ),
}


def lambda_handler(event, context):
    if isinstance(event, dict) and event.get("mode") == "gate2-bench":
        return gate2_bench()

    client, table, s3 = _wsf(), _table(), boto3.client("s3")
    refreshed: list[str] = []
    for sub_api, (publish, raw_fetcher, raw_name, path) in _DATASETS.items():
        token = client.cache_flush_date(sub_api)
        if token == _stored_token(table, sub_api):
            continue
        publish(s3, client)
        archive_dim(s3, os.environ["RAW_BUCKET"], raw_name, getattr(client, raw_fetcher)(), token)
        _store_token(table, sub_api, token)
        refreshed.append(path)

    if refreshed and (dist := os.environ.get("DISTRIBUTION_ID")):
        boto3.client("cloudfront").create_invalidation(
            DistributionId=dist,
            InvalidationBatch={
                "Paths": {"Quantity": len(refreshed), "Items": refreshed},
                "CallerReference": f"dims-{int(time.time())}",
            },
        )

    emit(DimsRefreshed=len(refreshed))
    return {"refreshed": refreshed}


def gate2_bench() -> dict:
    """ADR-0001 Gate-2 in-region confirmation: the spike's read patterns."""
    table = _table()
    get_ms: list[float] = []
    query_ms: list[float] = []
    for i in range(1000):
        t0 = time.perf_counter()
        table.get_item(Key={"PK": "FLEET", "SK": f"VESSEL#{(i % 21) + 1:04d}"})
        get_ms.append((time.perf_counter() - t0) * 1000)
    for _ in range(500):
        t0 = time.perf_counter()
        table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq("FLEET"),
            Limit=5,
        )
        query_ms.append((time.perf_counter() - t0) * 1000)

    def pctile(xs: list[float], p: float) -> float:
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, int(len(xs) * p / 100))], 2)

    return {
        "get_item_ms": {"p50": pctile(get_ms, 50), "p95": pctile(get_ms, 95)},
        "query_ms": {"p50": pctile(query_ms, 50), "p95": pctile(query_ms, 95)},
        "n": {"get": len(get_ms), "query": len(query_ms)},
        "measured_from": "lambda in-region us-west-2",
        "captured_at": datetime.now(UTC).isoformat(),
    }
