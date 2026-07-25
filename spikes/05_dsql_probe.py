"""Aurora DSQL probe (wildcard): compatibility findings, not a full bench.

Timebox: 45 minutes wall clock. Creates a single-region cluster (free tier
expected - verify in pricing pass), attempts FK DDL (expected to fail - we
want the exact error text for the ADR), loads 100k rows, times two queries,
deletes the cluster. Any friction -> record the finding and move on; this
wildcard only needs enough evidence to embrace or dismiss.

Run: uv run --with "boto3,psycopg[binary],pyarrow" python spikes/05_dsql_probe.py
"""

from __future__ import annotations

import time

import psycopg
import pyarrow.parquet as pq

from _config import DATA_DIR, PREFIX, TAGS_DICT, account_id, save_results, session

TIMEBOX_S = 45 * 60
FINDINGS = {"created": False, "fk_error": None, "load_100k_s": None,
            "q2_lite_ms": None, "q6_ms": None, "friction": []}


def main():
    t_start = time.time()
    sess = session()
    account_id(sess)
    dsql = sess.client("dsql")

    # ---- create cluster ----
    try:
        cluster = dsql.create_cluster(deletionProtectionEnabled=False, tags=TAGS_DICT)
        cid = cluster["identifier"]
        print(f"cluster {cid} creating...")
        while dsql.get_cluster(identifier=cid)["status"] not in ("ACTIVE",):
            if time.time() - t_start > TIMEBOX_S:
                FINDINGS["friction"].append("cluster not ACTIVE within timebox")
                return finish(sess, None)
            time.sleep(10)
        FINDINGS["created"] = True
    except Exception as e:
        FINDINGS["friction"].append(f"create_cluster: {type(e).__name__}: {e}")
        return finish(sess, None)

    host = f"{cid}.dsql.us-west-2.on.aws"
    token = dsql.generate_db_connect_admin_auth_token(Hostname=host) if hasattr(
        dsql, "generate_db_connect_admin_auth_token") else None
    if token is None:
        # token helper moved between SDK versions; try the documented client method names
        for name in ("generate_connect_admin_auth_token", "generate_db_connect_admin_auth_token"):
            if hasattr(dsql, name):
                token = getattr(dsql, name)(Hostname=host)
                break
    if token is None:
        FINDINGS["friction"].append("no auth-token helper in this boto3; note SDK version")
        return finish(sess, cid)

    try:
        conn = psycopg.connect(host=host, user="admin", password=token, dbname="postgres",
                               sslmode="require", connect_timeout=15, autocommit=True)
    except Exception as e:
        FINDINGS["friction"].append(f"connect: {type(e).__name__}: {e}")
        return finish(sess, cid)

    # ---- FK attempt (the point of the probe) ----
    try:
        conn.execute("CREATE TABLE vessel (id int PRIMARY KEY, name text)")
        conn.execute("""CREATE TABLE sailing (
            id int PRIMARY KEY, vessel_id int REFERENCES vessel(id), delay_min real)""")
        FINDINGS["fk_error"] = "NO ERROR - foreign keys accepted?! re-verify docs"
    except Exception as e:
        FINDINGS["fk_error"] = f"{type(e).__name__}: {e}"
        print(f"FK DDL failed as expected: {FINDINGS['fk_error'][:120]}")

    # ---- small load + two timings ----
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS history (
            route_id smallint, route_abbrev text, vessel_name text, service_date date,
            scheduled_depart timestamp, delay_min real, cancelled boolean)""")
        f = sorted((DATA_DIR / "history").rglob("*.parquet"))[-1]
        batch = next(pq.ParquetFile(f).iter_batches(100_000))
        rows = list(zip(batch.column(0).to_pylist(), batch.column(1).to_pylist(),
                        batch.column(2).to_pylist(), batch.column(3).to_pylist(),
                        batch.column(6).to_pylist(), batch.column(8).to_pylist(),
                        batch.column(9).to_pylist()))
        t0 = time.time()
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO history VALUES (%s,%s,%s,%s,%s,%s,%s)", rows[:100_000])
        FINDINGS["load_100k_s"] = round(time.time() - t0, 1)
        t0 = time.perf_counter()
        conn.execute("""SELECT route_abbrev, avg(delay_min), count(*) FROM history
                        WHERE NOT cancelled GROUP BY route_abbrev""").fetchall()
        FINDINGS["q2_lite_ms"] = round((time.perf_counter() - t0) * 1000)
        t0 = time.perf_counter()
        conn.execute("SELECT * FROM history WHERE route_id = 7 AND service_date = '2026-03-04'").fetchall()
        FINDINGS["q6_ms"] = round((time.perf_counter() - t0) * 1000)
    except Exception as e:
        FINDINGS["friction"].append(f"load/query: {type(e).__name__}: {e}")

    finish(sess, cid)


def finish(sess, cid):
    if cid:
        try:
            sess.client("dsql").delete_cluster(identifier=cid)
            print(f"cluster {cid} delete requested")
        except Exception as e:
            FINDINGS["friction"].append(f"delete_cluster: {e} - RUN 99_teardown.py")
    save_results("dsql", FINDINGS)
    print(FINDINGS)


if __name__ == "__main__":
    main()
