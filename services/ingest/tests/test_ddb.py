from wsf_ingest.ddb import PollerState

# The FLEET#/VESSEL# rows and their TimeStamp-dedup tests were retired on
# 2026-08-24 (ADR-0005, amended): ~93,000 write units/day maintaining 21
# items that no production code read. What the poller still owns in
# DynamoDB is its own liveness record, below.


def test_meta_item(aws):
    writer = PollerState(aws["table"])
    writer.write_meta(polls_ok=3, polls_failed=1, last_error="boom")
    meta = aws["table"].get_item(Key={"PK": "META", "SK": "POLLER#vessellocations"})["Item"]
    assert meta["polls_ok"] == 3
    assert meta["last_error"] == "boom"
    assert "last_success_utc" in meta


def test_meta_omits_success_stamp_when_every_poll_failed(aws):
    writer = PollerState(aws["table"])
    writer.write_meta(polls_ok=0, polls_failed=4, last_error="all four failed")
    meta = aws["table"].get_item(Key={"PK": "META", "SK": "POLLER#vessellocations"})["Item"]
    assert meta["polls_failed"] == 4
    assert "last_success_utc" not in meta, "a failed minute must not look like a success"


def test_long_errors_are_truncated_not_rejected(aws):
    PollerState(aws["table"]).write_meta(polls_ok=0, polls_failed=1, last_error="x" * 5000)
    meta = aws["table"].get_item(Key={"PK": "META", "SK": "POLLER#vessellocations"})["Item"]
    assert len(meta["last_error"]) == 1000


def test_the_poller_no_longer_writes_vessel_rows(aws, vessellocations_rows, monkeypatch):
    """The map is served from the S3 snapshot via CloudFront (ADR-0005), the
    raw NDJSON archive is the position history, and nothing reads
    FLEET#/VESSEL#. Re-adding those writes would restore ~93,000 write
    units/day for data with no consumer."""
    import boto3
    from wsf_ingest import poller

    monkeypatch.setenv("POLL_ITERATIONS", "1")
    monkeypatch.setenv("POLL_SPACING_S", "0")

    class _FakeClient:
        def vessel_locations_raw(self):
            return vessellocations_rows

    poller._client = _FakeClient()
    poller._writer = PollerState(aws["table"])
    poller.lambda_handler({}, None)

    resp = aws["table"].query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("PK").eq("FLEET")
    )
    assert resp["Count"] == 0, "the poller must not write per-vessel rows"
