import gzip
import io
import json

import pyarrow.parquet as pq
from wsf_analytics import transform

# 2015-06-15 10:00 PDT and a +7 min actual.
SCHED = "/Date(1434387600000-0700)/"
ACTUAL = "/Date(1434388020000-0700)/"
# 2015-12-31 23:00 PST -> service year 2015 local, 2016-01-01 UTC.
NYE = "/Date(1451631600000-0800)/"


def row(vessel="Tacoma", dep="Bainbridge", arr="Colman", sched=SCHED, actual=ACTUAL):
    return {
        "Vessel": vessel,
        "Departing": dep,
        "Arriving": arr,
        "ScheduledDepart": sched,
        "ActualDepart": actual,
    }


def put_raw(aws, rows, fetched_at="2026-07-30T10:00:00+00:00", name="0001.ndjson.gz"):
    line = json.dumps(
        {
            "fetched_at": fetched_at,
            "status": 200,
            "body": {"vessel": "x", "date_start": "d", "date_end": "d", "rows": rows},
        }
    )
    aws["s3"].put_object(
        Bucket="wsf-test-raw",
        Key=f"raw/vesselhistory/dt=2026-07-30/{name}",
        Body=gzip.compress((line + "\n").encode()),
    )


def read_year(aws, year):
    body = (
        aws["s3"]
        .get_object(Bucket="wsf-test-raw", Key=f"analytics/history/year={year}/part-0.parquet")[
            "Body"
        ]
        .read()
    )
    return pq.read_table(io.BytesIO(body)).to_pylist()


def test_normalizes_local_columns_and_delay(aws):
    put_raw(aws, [row()])
    result = transform.lambda_handler({"years": [2015], "chain": False}, None)
    assert result["RowsWritten"] == 1
    (out,) = read_year(aws, 2015)
    assert out["vessel_name"] == "Tacoma"
    assert out["departing_terminal_id"] == 3 and out["arriving_terminal_id"] == 7
    assert out["depart_hhmm_local"] == "10:00"
    assert str(out["service_date"]) == "2015-06-15"
    assert abs(out["delay_min"] - 7.0) < 0.01


def test_year_is_pacific_wall_clock(aws):
    put_raw(aws, [row(sched=NYE, actual=None)])
    result = transform.lambda_handler({"years": [2015, 2016], "chain": False}, None)
    assert result["written"] == {2015: 1}  # UTC says 2016; the Sound says New Year's Eve
    (out,) = read_year(aws, 2015)
    assert out["depart_hhmm_local"] == "23:00"
    assert out["actual_depart"] is None and out["delay_min"] is None


def test_dedup_latest_fetch_wins(aws):
    put_raw(aws, [row(actual=SCHED)], fetched_at="2026-07-29T00:00:00+00:00", name="0001.ndjson.gz")
    put_raw(
        aws, [row(actual=ACTUAL)], fetched_at="2026-07-30T00:00:00+00:00", name="0002.ndjson.gz"
    )
    result = transform.lambda_handler({"years": [2015], "chain": False}, None)
    assert result["DuplicatesDropped"] == 1
    (out,) = read_year(aws, 2015)
    assert abs(out["delay_min"] - 7.0) < 0.01  # the corrected (later) fetch won


def test_null_and_unmapped_slips_quarantine(aws):
    put_raw(aws, [row(dep=None), row(dep="Narnia"), row()])
    result = transform.lambda_handler({"years": [2015], "chain": False}, None)
    assert result["NullSlip"] == 1 and result["UnmappedSlip"] == 1
    assert result["RowsWritten"] == 1
    keys = [
        o["Key"]
        for o in aws["s3"].list_objects_v2(Bucket="wsf-test-raw", Prefix="analytics/quarantine/")[
            "Contents"
        ]
    ]
    assert len(keys) == 1
    q = gzip.decompress(
        aws["s3"].get_object(Bucket="wsf-test-raw", Key=keys[0])["Body"].read()
    ).decode()
    assert '"null_slip"' in q and '"unmapped_slip"' in q


def test_rerun_is_idempotent_single_file(aws):
    put_raw(aws, [row()])
    transform.lambda_handler({"years": [2015], "chain": False}, None)
    transform.lambda_handler({"years": [2015], "chain": False}, None)
    files = [
        o["Key"]
        for o in aws["s3"].list_objects_v2(
            Bucket="wsf-test-raw", Prefix="analytics/history/year=2015/"
        )["Contents"]
    ]
    assert files == ["analytics/history/year=2015/part-0.parquet"]  # never a second file
    assert len(read_year(aws, 2015)) == 1
