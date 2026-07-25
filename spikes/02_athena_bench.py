"""Athena bench: upload the synthetic history, run 6 canonical queries x3.

Captures engine latency p50/p95, bytes scanned, and computed $ per query.
Est. cost: ~60 MB dataset -> even 18 full scans is ~1 GB ~= $0.005. S3: pennies.

Run: uv run --with boto3 python spikes/02_athena_bench.py
"""

from __future__ import annotations

import time

from _config import (BUDGET_USD, DATA_DIR, PREFIX, REGION, TAGS, account_id,
                     bucket_name, pctile, record_spend, save_results, session)

ATHENA_DB = "wsf_spike"
TABLE = "history"
PRICE_PER_TB = 5.00  # verify against the pricing pass

QUERIES = {
    "q1_daily_ontime_14d": f"""
        SELECT service_date, count(*) sailings,
               avg(CASE WHEN delay_min <= 10 THEN 1.0 ELSE 0.0 END) ontime
        FROM {TABLE}
        WHERE year = 2026 AND route_id = 5 AND NOT cancelled
          AND service_date BETWEEN date '2026-07-01' AND date '2026-07-14'
        GROUP BY service_date ORDER BY service_date""",
    "q2_route_percentiles_full": f"""
        SELECT route_abbrev, approx_percentile(delay_min, 0.5) p50,
               approx_percentile(delay_min, 0.9) p90, count(*) n
        FROM {TABLE} WHERE NOT cancelled GROUP BY route_abbrev ORDER BY p90 DESC""",
    "q3_vessel_season": f"""
        SELECT vessel_name, year,
               avg(CASE WHEN delay_min <= 10 THEN 1.0 ELSE 0.0 END) ontime, count(*) n
        FROM {TABLE} WHERE NOT cancelled GROUP BY vessel_name, year""",
    "q4_cancellation_monthly": f"""
        SELECT route_abbrev, year, month(scheduled_depart) m,
               avg(CASE WHEN cancelled THEN 1.0 ELSE 0.0 END) cancel_rate
        FROM {TABLE} GROUP BY route_abbrev, year, month(scheduled_depart)""",
    "q5_worst_delays": f"""
        SELECT service_date, route_abbrev, vessel_name, delay_min
        FROM {TABLE} WHERE NOT cancelled ORDER BY delay_min DESC LIMIT 100""",
    "q6_point_lookup": f"""
        SELECT * FROM {TABLE}
        WHERE year = 2019 AND route_id = 7 AND service_date = date '2019-03-04'
        ORDER BY scheduled_depart""",
}


def upload(sess, bucket):
    s3 = sess.client("s3")
    try:
        s3.head_bucket(Bucket=bucket)
        print(f"bucket {bucket} exists")
    except Exception:
        s3.create_bucket(Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": REGION})
        s3.put_bucket_tagging(Bucket=bucket, Tagging={"TagSet": TAGS})
        print(f"created s3://{bucket}")
    files = sorted((DATA_DIR / "history").rglob("*.parquet"))
    total = 0
    for f in files:
        key = f"history/{f.parent.name}/{f.name}"
        s3.upload_file(str(f), bucket, key)
        total += f.stat().st_size
    print(f"uploaded {len(files)} files, {total/1e6:.1f} MB")
    record_spend("s3_storage_month", total / 1e9 * 0.023)


def ddl(sess, bucket):
    athena = sess.client("athena")
    wg_out = f"s3://{bucket}/athena-results/"
    try:
        sess.client("athena").create_work_group(
            Name=PREFIX, Configuration={
                "ResultConfiguration": {"OutputLocation": wg_out},
                "BytesScannedCutoffPerQuery": 2 * 1024 ** 3,
            }, Tags=TAGS)
        print(f"workgroup {PREFIX} created (2 GB per-query cutoff)")
    except athena.exceptions.InvalidRequestException:
        print(f"workgroup {PREFIX} exists")

    run(sess, f"CREATE DATABASE IF NOT EXISTS {ATHENA_DB}", database=None)
    run(sess, f"""
        CREATE EXTERNAL TABLE IF NOT EXISTS {TABLE} (
          route_id smallint, route_abbrev string, vessel_name string,
          service_date date, departing_terminal_id smallint,
          arriving_terminal_id smallint, scheduled_depart timestamp,
          actual_depart timestamp, delay_min float, cancelled boolean)
        PARTITIONED BY (year int)
        STORED AS PARQUET LOCATION 's3://{bucket}/history/'
        TBLPROPERTIES (
          'projection.enabled'='true', 'projection.year.type'='integer',
          'projection.year.range'='2002,2026',
          'storage.location.template'='s3://{bucket}/history/year=${{year}}/')""")


def run(sess, sql, database=ATHENA_DB):
    athena = sess.client("athena")
    kwargs = {"QueryString": sql, "WorkGroup": PREFIX}
    if database:
        kwargs["QueryExecutionContext"] = {"Database": database}
    qid = athena.start_query_execution(**kwargs)["QueryExecutionId"]
    while True:
        q = athena.get_query_execution(QueryExecutionId=qid)["QueryExecution"]
        state = q["Status"]["State"]
        if state in ("SUCCEEDED", "FAILED", "CANCELLED"):
            if state != "SUCCEEDED":
                raise RuntimeError(f"query {state}: {q['Status'].get('StateChangeReason')}\n{sql[:200]}")
            stats = q.get("Statistics", {})
            return {
                "engine_ms": stats.get("EngineExecutionTimeInMillis", 0),
                "total_ms": stats.get("TotalExecutionTimeInMillis", 0),
                "bytes": stats.get("DataScannedInBytes", 0),
            }
        time.sleep(0.4)


def main():
    sess = session()
    acct = account_id(sess)
    bucket = bucket_name(acct)
    upload(sess, bucket)
    ddl(sess, bucket)

    results, spend = {}, 0.0
    for name, sql in QUERIES.items():
        runs = []
        for i in range(3):
            r = run(sess, sql)
            runs.append(r)
            cost = r["bytes"] / 1e12 * PRICE_PER_TB
            spend += cost
            print(f"{name} run{i+1}: engine {r['engine_ms']} ms, total {r['total_ms']} ms, "
                  f"{r['bytes']/1e6:.1f} MB scanned (${cost:.5f})")
        results[name] = {
            "engine_ms_p50": pctile([r["engine_ms"] for r in runs], 50),
            "total_ms_p95": pctile([r["total_ms"] for r in runs], 95),
            "mb_scanned": round(runs[0]["bytes"] / 1e6, 2),
            "usd_per_run": round(runs[0]["bytes"] / 1e12 * PRICE_PER_TB, 6),
            "runs": runs,
        }
    record_spend("athena_queries", spend)
    save_results("athena", {"bucket": bucket, "queries": results})
    print("\nGate 3 check: ad-hoc p95 <= 10s ->",
          all(v["total_ms_p95"] <= 10_000 for v in results.values()))


if __name__ == "__main__":
    main()
