import gzip
import json
from datetime import UTC, datetime

from wsf_ingest.archive import ArchiveBatch, archive_dim

RAW_BUCKET = "wsf-test-raw"


def test_batch_flush_roundtrip(aws):
    batch = ArchiveBatch(aws["s3"], RAW_BUCKET)
    now = datetime(2026, 7, 29, 14, 30, 12, tzinfo=UTC)
    for i in range(4):
        batch.add(fetched_at=now, status=200, body=[{"poll": i}])

    key = batch.flush(now=now)
    assert key == "raw/vessellocations/dt=2026-07-29/1430.ndjson.gz"

    obj = aws["s3"].get_object(Bucket=RAW_BUCKET, Key=key)
    lines = gzip.decompress(obj["Body"].read()).decode().strip().split("\n")
    assert len(lines) == 4
    assert json.loads(lines[2])["body"] == [{"poll": 2}]
    assert obj["ContentEncoding"] == "gzip"

    assert batch.flush() is None  # emptied by the successful flush


def test_dim_archive(aws, terminallocations_rows):
    key = archive_dim(
        aws["s3"], RAW_BUCKET, "terminallocations", terminallocations_rows, "/Date(0)/"
    )
    assert key.startswith("raw/terminallocations/dt=")
    body = json.loads(
        gzip.decompress(aws["s3"].get_object(Bucket=RAW_BUCKET, Key=key)["Body"].read())
    )
    assert body["cacheflushdate"] == "/Date(0)/"
    assert len(body["body"]) == 20


def test_flush_suffix_disambiguates_same_minute_writers(aws):
    from datetime import UTC, datetime

    from wsf_ingest.archive import ArchiveBatch

    now = datetime(2026, 7, 29, 14, 30, tzinfo=UTC)
    batch = ArchiveBatch(aws["s3"], "wsf-test-raw")
    batch.add(fetched_at=now, status=200, body=[1])
    key = batch.flush(dataset="vesselhistory", now=now, suffix="tacoma-2015")
    assert key == "raw/vesselhistory/dt=2026-07-29/1430-tacoma-2015.ndjson.gz"
    # No suffix keeps the M1 key contract byte-identical.
    batch.add(fetched_at=now, status=200, body=[2])
    assert batch.flush(now=now) == "raw/vessellocations/dt=2026-07-29/1430.ndjson.gz"
