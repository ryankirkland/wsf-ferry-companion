"""RDS bench (Option B): t4g.micro Postgres, load 5M rows, query + concurrency.

Creates a single-AZ db.t4g.micro reachable ONLY from this machine's IP, loads
the same synthetic history via COPY, runs the same 6 analytical queries, then
probes 50 concurrent connections (the Lambda fan-out question). Deletes the
instance at the end (no snapshot). Cost: ~2h x $0.0168 + 20GB gp3 prorated
~= well under $0.50. Instance creation takes 5-10 minutes - be patient.

Run: uv run --with "boto3,psycopg[binary],pyarrow,requests" python spikes/04_rds_bench.py
Cleanup on failure: uv run --with boto3 python spikes/99_teardown.py
"""

from __future__ import annotations

import concurrent.futures as cf
import secrets
import time

import psycopg
import pyarrow.parquet as pq
import requests

from _config import DATA_DIR, PREFIX, TAGS, account_id, pctile, record_spend, save_results, session

DB_ID = f"{PREFIX}-pg"
DB_NAME = "wsf"
DB_USER = "spike"

QUERIES = {
    "q1_daily_ontime_14d": """
        SELECT service_date, count(*),
               avg(CASE WHEN delay_min <= 10 THEN 1.0 ELSE 0.0 END)
        FROM history WHERE route_id = 5 AND NOT cancelled
          AND service_date BETWEEN '2026-07-01' AND '2026-07-14'
        GROUP BY service_date ORDER BY service_date""",
    "q2_route_percentiles_full": """
        SELECT route_abbrev,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_min) p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY delay_min) p90, count(*)
        FROM history WHERE NOT cancelled GROUP BY route_abbrev ORDER BY p90 DESC""",
    "q3_vessel_season": """
        SELECT vessel_name, extract(year FROM service_date),
               avg(CASE WHEN delay_min <= 10 THEN 1.0 ELSE 0.0 END), count(*)
        FROM history WHERE NOT cancelled GROUP BY 1, 2""",
    "q4_cancellation_monthly": """
        SELECT route_abbrev, extract(year FROM service_date), extract(month FROM service_date),
               avg(CASE WHEN cancelled THEN 1.0 ELSE 0.0 END)
        FROM history GROUP BY 1, 2, 3""",
    "q5_worst_delays": """
        SELECT service_date, route_abbrev, vessel_name, delay_min
        FROM history WHERE NOT cancelled ORDER BY delay_min DESC LIMIT 100""",
    "q6_point_lookup": """
        SELECT * FROM history
        WHERE route_id = 7 AND service_date = '2019-03-04' ORDER BY scheduled_depart""",
}


def my_ip():
    return requests.get("https://checkip.amazonaws.com", timeout=10).text.strip()


def ensure_instance(sess, password):
    rds = sess.client("rds")
    ec2 = sess.client("ec2")
    ip = my_ip()
    vpc = ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])["Vpcs"][0]["VpcId"]
    try:
        sg = ec2.create_security_group(GroupName=f"{PREFIX}-sg", VpcId=vpc,
                                       Description="wsf spike - psql from one IP",
                                       TagSpecifications=[{"ResourceType": "security-group",
                                                           "Tags": TAGS}])["GroupId"]
        ec2.authorize_security_group_ingress(GroupId=sg, IpProtocol="tcp", FromPort=5432,
                                             ToPort=5432, CidrIp=f"{ip}/32")
        print(f"security group {sg} (5432 from {ip}/32 only)")
    except ec2.exceptions.ClientError as e:
        if "InvalidGroup.Duplicate" not in str(e):
            raise
        sg = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": [f"{PREFIX}-sg"]}]
                                          )["SecurityGroups"][0]["GroupId"]
    try:
        rds.describe_db_instances(DBInstanceIdentifier=DB_ID)
        print(f"instance {DB_ID} exists")
    except rds.exceptions.DBInstanceNotFoundFault:
        rds.create_db_instance(
            DBInstanceIdentifier=DB_ID, DBInstanceClass="db.t4g.micro", Engine="postgres",
            AllocatedStorage=20, StorageType="gp3", MasterUsername=DB_USER,
            MasterUserPassword=password, DBName=DB_NAME, PubliclyAccessible=True,
            VpcSecurityGroupIds=[sg], BackupRetentionPeriod=0, MultiAZ=False,
            Tags=TAGS, DeletionProtection=False)
        print("creating db.t4g.micro (5-10 min)...")
    rds.get_waiter("db_instance_available").wait(DBInstanceIdentifier=DB_ID,
                                                 WaiterConfig={"Delay": 20, "MaxAttempts": 60})
    host = rds.describe_db_instances(DBInstanceIdentifier=DB_ID
                                     )["DBInstances"][0]["Endpoint"]["Address"]
    print(f"available: {host}")
    return host


def load(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS history (
        route_id smallint, route_abbrev text, vessel_name text, service_date date,
        departing_terminal_id smallint, arriving_terminal_id smallint,
        scheduled_depart timestamp, actual_depart timestamp,
        delay_min real, cancelled boolean)""")
    n = conn.execute("SELECT count(*) FROM history").fetchone()[0]
    if n > 4_000_000:
        print(f"history already loaded ({n:,})")
        return
    t0 = time.time()
    files = sorted((DATA_DIR / "history").rglob("*.parquet"))
    with conn.cursor().copy("COPY history FROM STDIN") as copy:
        for f in files:
            for batch in pq.ParquetFile(f).iter_batches(65536):
                for row in zip(*[batch.column(i).to_pylist() for i in range(batch.num_columns)]):
                    copy.write_row(row)
    conn.execute("ANALYZE history")
    conn.commit()
    print(f"loaded {conn.execute('SELECT count(*) FROM history').fetchone()[0]:,} rows "
          f"in {time.time()-t0:.0f}s")


def bench_queries(conn):
    out = {}
    for name, sql in QUERIES.items():
        times = []
        for _ in range(3):
            t0 = time.perf_counter()
            conn.execute(sql).fetchall()
            times.append((time.perf_counter() - t0) * 1000)
        out[name] = {"ms_p50": round(pctile(times, 50)), "ms_max": round(max(times))}
        print(f"{name}: p50 {out[name]['ms_p50']} ms")
    return out


def bench_concurrency(dsn):
    """50 parallel connections doing the point lookup - the Lambda fan-out shape."""
    def one(_):
        try:
            t0 = time.perf_counter()
            with psycopg.connect(dsn, connect_timeout=10) as c:
                c.execute(QUERIES["q6_point_lookup"]).fetchall()
            return ("ok", (time.perf_counter() - t0) * 1000)
        except Exception as e:
            return ("err", type(e).__name__)
    with cf.ThreadPoolExecutor(50) as ex:
        results = list(ex.map(one, range(50)))
    ok = [ms for s, ms in results if s == "ok"]
    errs = [e for s, e in results if s == "err"]
    return {"ok": len(ok), "errors": errs,
            "ms_p50": round(pctile(ok, 50)) if ok else None,
            "ms_p95": round(pctile(ok, 95)) if ok else None}


def main():
    sess = session()
    account_id(sess)
    password = secrets.token_urlsafe(18)
    host = ensure_instance(sess, password)
    print("NOTE: if the instance pre-existed, rerun teardown first - password just rotated? "
          "No: password only applies on create. For a pre-existing instance, tear down and rerun.")
    dsn = f"host={host} dbname={DB_NAME} user={DB_USER} password={password} sslmode=require"
    with psycopg.connect(dsn) as conn:
        load(conn)
        queries = bench_queries(conn)
    conc = bench_concurrency(dsn)
    print(f"concurrency 50: ok={conc['ok']} errors={conc['errors'][:3]} p95={conc['ms_p95']} ms")
    record_spend("rds_hours", 3 * 0.0168 + 0.20)
    save_results("rds", {"queries": queries, "concurrency_50": conc,
                          "instance": "db.t4g.micro single-AZ 20GB gp3"})
    sess.client("rds").delete_db_instance(DBInstanceIdentifier=DB_ID, SkipFinalSnapshot=True)
    print(f"delete requested for {DB_ID} (verify with 99_teardown.py)")


if __name__ == "__main__":
    main()
