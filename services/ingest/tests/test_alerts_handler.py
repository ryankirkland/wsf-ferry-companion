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


class RecordingLambda:
    def __init__(self, fail_on_invoke=False):
        self.invokes = []
        self.fail = fail_on_invoke

    def invoke(self, **kwargs):
        if self.fail:
            raise RuntimeError("lambda control plane down")
        self.invokes.append(kwargs)
        return {"StatusCode": 202}


def test_notifier_invoked_with_slim_feed_before_watermark(aws, monkeypatch, alerts_rows_ingest):
    fake = FakeWsf(alerts_rows_ingest)
    lam = RecordingLambda()
    monkeypatch.setenv("NOTIFIER_FUNCTION", "wsf-prod-notify-fanout")
    # Route only the lambda client to the recorder; s3/dynamodb stay real (moto).
    import boto3 as real_boto3

    monkeypatch.setattr(
        alerts_mod.boto3,
        "client",
        lambda svc, **kw: lam if svc == "lambda" else real_boto3.Session().client(svc, **kw),
    )
    result = _run(monkeypatch, fake)
    assert result["changed"] is True
    payloads = [json.loads(k["Payload"]) for k in lam.invokes]
    fanout = next(p for p in payloads if "alerts" in p)
    assert len(fanout["alerts"]) == 9 and "observed_at_ms" in fanout


def test_crash_before_watermark_means_next_run_retries(aws, monkeypatch, alerts_rows_ingest):
    # Invoke-then-watermark ordering: if the notifier invoke blows up, the
    # watermark must NOT have been stored - the next minute repeats the whole
    # change detection instead of silently swallowing the notification.
    fake = FakeWsf(alerts_rows_ingest)
    import boto3 as real_boto3

    lam = RecordingLambda(fail_on_invoke=True)
    monkeypatch.setenv("NOTIFIER_FUNCTION", "wsf-prod-notify-fanout")
    monkeypatch.setattr(
        alerts_mod.boto3,
        "client",
        lambda svc, **kw: lam if svc == "lambda" else real_boto3.Session().client(svc, **kw),
    )
    import pytest as _pytest

    with _pytest.raises(RuntimeError):
        _run(monkeypatch, fake)
    stored = aws["table"].get_item(Key={"PK": "META", "SK": "ALERTS#watermark"}).get("Item")
    assert stored is None  # watermark not written -> next run re-detects

    lam.fail = False
    result = _run(monkeypatch, fake)
    assert result["changed"] is True  # retried and completed
