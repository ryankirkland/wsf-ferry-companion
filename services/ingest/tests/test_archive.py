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
