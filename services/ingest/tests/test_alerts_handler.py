import json

from wsf_ingest import alerts as alerts_mod

DATA_BUCKET = "wsf-test-data"
RAW_BUCKET = "wsf-test-raw"


class FakeWsf:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def alerts_raw(self):
        self.calls += 1
        return self.rows


def _run(monkeypatch, fake):
    monkeypatch.setattr(alerts_mod, "_client", fake)
    return alerts_mod.lambda_handler({}, None)


def test_first_run_publishes_and_stores_watermark(aws, monkeypatch, alerts_rows_ingest):
    fake = FakeWsf(alerts_rows_ingest)
    result = _run(monkeypatch, fake)
    assert result["changed"] is True

    doc = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/alerts.json")["Body"].read()
    )
    assert doc["v"] == 1 and len(doc["alerts"]) == 9
    assert all("<" not in (a["text"] or "") for a in doc["alerts"])
    # Newest first.
    published = [a["published"] for a in doc["alerts"]]
    assert published == sorted(published, reverse=True)

    meta = aws["table"].get_item(Key={"PK": "META", "SK": "ALERTS#watermark"})["Item"]
    assert meta["watermark"] == doc["watermark"]

    raw_keys = [o["Key"] for o in aws["s3"].list_objects_v2(Bucket=RAW_BUCKET)["Contents"]]
    assert any("raw/alerts/" in k for k in raw_keys)


def test_unchanged_watermark_writes_nothing(aws, monkeypatch, alerts_rows_ingest):
    fake = FakeWsf(alerts_rows_ingest)
    _run(monkeypatch, fake)
    before = aws["s3"].list_objects_v2(Bucket=RAW_BUCKET)["KeyCount"]
    result = _run(monkeypatch, fake)
    assert result["changed"] is False
    assert aws["s3"].list_objects_v2(Bucket=RAW_BUCKET)["KeyCount"] == before
