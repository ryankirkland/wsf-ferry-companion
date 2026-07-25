"""DynamoDB bench: single-table hot-state design, load, and read timings.

Measures GetItem (current fleet) and Query (next departures per terminal pair)
from this machine. WAN latency dominates from a laptop - the JSON records both
the measured numbers and that caveat; in-region numbers come from a Lambda in
M0 if needed. On-demand cost for this spike is fractions of a cent.

Single-table design under test:
  PK="FLEET"            SK=<vessel_name>          -> current position blob
  PK="PAIR#<dep>#<arr>" SK=<departing_iso>        -> upcoming departure
  PK="ALERTS"           SK=<bulletin_id>          -> active alert

Run: uv run --with boto3 python spikes/03_dynamo_bench.py
"""

from __future__ import annotations

import random
import time
from datetime import datetime, timedelta, timezone

from _config import PREFIX, TAGS, account_id, pctile, record_spend, save_results, session

TABLE = f"{PREFIX}-hot"
VESSELS = ["Tacoma", "Wenatchee", "Puyallup", "Chimacum", "Kaleetan", "Spokane",
           "Suquamish", "Tokitae", "Kennewick", "Salish", "Yakima", "Samish",
           "Chelan", "Tillikum", "Cathlamet", "Kitsap", "Issaquah", "Kittitas",
           "Sealth", "Walla Walla", "Chetzemoka"]
PAIRS = [("7", "3"), ("3", "7"), ("7", "4"), ("4", "7"), ("8", "12"), ("12", "8"),
         ("14", "5"), ("5", "14"), ("1", "10"), ("9", "22")]


def ensure_table(sess):
    ddb = sess.client("dynamodb")
    try:
        ddb.describe_table(TableName=TABLE)
        print(f"table {TABLE} exists")
        return
    except ddb.exceptions.ResourceNotFoundException:
        pass
    ddb.create_table(
        TableName=TABLE, BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"},
                              {"AttributeName": "SK", "AttributeType": "S"}],
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"},
                   {"AttributeName": "SK", "KeyType": "RANGE"}],
        Tags=[{"Key": t["Key"], "Value": t["Value"]} for t in TAGS])
    ddb.get_waiter("table_exists").wait(TableName=TABLE)
    print(f"created table {TABLE} (on-demand)")


def load(sess):
    table = sess.resource("dynamodb").Table(TABLE)
    now = datetime.now(timezone.utc)
    with table.batch_writer() as bw:
        for v in VESSELS:
            bw.put_item(Item={"PK": "FLEET", "SK": v, "lat": "47.62", "lon": "-122.45",
                              "speed": "16.2", "heading": "274", "at_dock": False,
                              "in_service": True, "ts": now.isoformat()})
        for dep, arr in PAIRS:
            for i in range(20):
                t = now + timedelta(minutes=25 * i)
                bw.put_item(Item={"PK": f"PAIR#{dep}#{arr}", "SK": t.isoformat(),
                                  "vessel": random.choice(VESSELS), "status": "ontime",
                                  "delay_min": 0})
        for b in range(7):
            bw.put_item(Item={"PK": "ALERTS", "SK": f"1167{b:02d}",
                              "title": "Vessel running behind", "routes": ["5"]})
    print(f"loaded {len(VESSELS)} fleet + {len(PAIRS)*20} departures + 7 alerts")


def bench(sess):
    ddb = sess.client("dynamodb")
    get_ms, query_ms = [], []
    for i in range(1000):
        v = VESSELS[i % len(VESSELS)]
        t0 = time.perf_counter()
        ddb.get_item(TableName=TABLE, Key={"PK": {"S": "FLEET"}, "SK": {"S": v}},
                     ConsistentRead=False)
        get_ms.append((time.perf_counter() - t0) * 1000)
    for i in range(500):
        dep, arr = PAIRS[i % len(PAIRS)]
        t0 = time.perf_counter()
        ddb.query(TableName=TABLE, KeyConditionExpression="PK = :pk",
                  ExpressionAttributeValues={":pk": {"S": f"PAIR#{dep}#{arr}"}},
                  Limit=5, ConsistentRead=False)
        query_ms.append((time.perf_counter() - t0) * 1000)
    return get_ms, query_ms


def main():
    sess = session()
    account_id(sess)
    ensure_table(sess)
    load(sess)
    get_ms, query_ms = bench(sess)
    out = {
        "caveat": "measured from laptop over WAN; in-region single-digit-ms expected, verify from Lambda in M0",
        "get_item_ms": {"p50": round(pctile(get_ms, 50), 1), "p95": round(pctile(get_ms, 95), 1)},
        "query_ms": {"p50": round(pctile(query_ms, 50), 1), "p95": round(pctile(query_ms, 95), 1)},
        "n": {"get": len(get_ms), "query": len(query_ms)},
    }
    record_spend("dynamo_ops", 0.01)
    save_results("dynamo", out)
    print(f"GetItem p50/p95: {out['get_item_ms']['p50']}/{out['get_item_ms']['p95']} ms (WAN)")
    print(f"Query   p50/p95: {out['query_ms']['p50']}/{out['query_ms']['p95']} ms (WAN)")


if __name__ == "__main__":
    main()
