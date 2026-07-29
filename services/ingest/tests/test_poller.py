import gzip
import json

import pytest
from wsf_core import WsfApiError, WsfAuthError
from wsf_ingest import poller

DATA_BUCKET = "wsf-test-data"
RAW_BUCKET = "wsf-test-raw"


class FakeWsf:
    def __init__(self, results):
        # results: list of callables or row-lists, one per expected poll
        self._results = list(results)
        self.calls = 0

    def vessel_locations_raw(self):
        self.calls += 1
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def fast_loop(monkeypatch):
    monkeypatch.setenv("POLL_ITERATIONS", "2")
    monkeypatch.setenv("POLL_SPACING_S", "0")


def _run(monkeypatch, aws, fake):
    monkeypatch.setattr(poller, "_client", fake)
    monkeypatch.setattr(poller, "_writer", None)  # rebuilt against the moto table
    return poller.lambda_handler({}, None)


def test_happy_two_polls(aws, fast_loop, monkeypatch, vessellocations_rows):
    fake = FakeWsf([vessellocations_rows, vessellocations_rows])
    counts = _run(monkeypatch, aws, fake)

    assert counts["PollSuccess"] == 2
    assert counts["VesselsWritten"] == 21  # second poll fully deduped

    snap = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/fleet.json")["Body"].read()
    )
    assert snap["v"] == 1 and len(snap["vessels"]) == 21

    archive_keys = [o["Key"] for o in aws["s3"].list_objects_v2(Bucket=RAW_BUCKET)["Contents"]]
    assert len(archive_keys) == 1  # one batched object per invocation
    body = gzip.decompress(
        aws["s3"].get_object(Bucket=RAW_BUCKET, Key=archive_keys[0])["Body"].read()
    )
    assert len(body.decode().strip().split("\n")) == 2  # both polls preserved

    meta = aws["table"].get_item(Key={"PK": "META", "SK": "POLLER#vessellocations"})["Item"]
    assert meta["polls_ok"] == 2


def test_auth_failure_aborts_loop(aws, fast_loop, monkeypatch, vessellocations_rows):
    fake = FakeWsf([WsfAuthError("register please", status=400), vessellocations_rows])
    counts = _run(monkeypatch, aws, fake)
    assert counts["AuthFailure"] == 1
    assert counts["PollSuccess"] == 0
    assert fake.calls == 1  # remaining iteration abandoned


def test_empty_fleet_keeps_last_good_snapshot(aws, fast_loop, monkeypatch, vessellocations_rows):
    fake = FakeWsf([vessellocations_rows, []])
    counts = _run(monkeypatch, aws, fake)
    assert counts["PollSuccess"] == 1
    assert counts["EmptyFleet"] == 1
    snap = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/fleet.json")["Body"].read()
    )
    assert len(snap["vessels"]) == 21  # the empty poll did not clobber it


def test_transport_failure_counts_without_raising(
    aws, fast_loop, monkeypatch, vessellocations_rows
):
    fake = FakeWsf([WsfApiError("boom", status=503), vessellocations_rows])
    counts = _run(monkeypatch, aws, fake)
    assert counts["PollFailure"] == 1
    assert counts["PollSuccess"] == 1
