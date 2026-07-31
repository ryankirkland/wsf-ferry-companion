import gzip
import json

from wsf_analytics import sync

ROW = {"Vessel": "Tacoma", "ScheduledDepart": "/Date(1784290800000-0700)/"}


class FakeWsf:
    def __init__(self, fail_for=(), rows_for=None):
        self.fail_for = set(fail_for)
        self.rows_for = rows_for or {}
        self.calls = []

    def vessel_history_raw(self, name, start, end):
        self.calls.append((name, start, end))
        if name in self.fail_for:
            raise RuntimeError("timeout")
        return self.rows_for.get(name, [ROW])


def _raw_bodies(aws):
    keys = [o["Key"] for o in aws["s3"].list_objects_v2(Bucket="wsf-test-raw").get("Contents", [])]
    out = {}
    for k in keys:
        data = gzip.decompress(aws["s3"].get_object(Bucket="wsf-test-raw", Key=k)["Body"].read())
        out[k] = [json.loads(line) for line in data.decode().strip().split("\n")]
    return out


def _run(monkeypatch, fake, event=None):
    monkeypatch.setattr(sync, "_client", fake)
    monkeypatch.setattr(sync.time, "sleep", lambda s: None)
    return sync.lambda_handler(event or {}, None)


def test_nightly_sweep_archives_all_vessels_one_batch(aws, monkeypatch):
    fake = FakeWsf()
    result = _run(monkeypatch, fake)
    assert result["HistoryVesselsFetched"] == 3
    assert result["HistoryRowsFetched"] == 3
    bodies = _raw_bodies(aws)
    assert len(bodies) == 1  # one batch, no same-minute collisions
    (lines,) = bodies.values()
    assert {ln["body"]["vessel"] for ln in lines} == {"Salish", "Tacoma", "Walla Walla"}
    # 7-day trailing window, dates in ISO.
    name, start, end = fake.calls[0]
    assert len(start) == 10 and len(end) == 10 and start < end


def test_one_failing_vessel_never_sinks_the_sweep(aws, monkeypatch):
    fake = FakeWsf(fail_for={"Walla Walla"})
    result = _run(monkeypatch, fake)
    assert result["HistoryVesselsFetched"] == 2
    assert result["HistoryVesselFailures"] == 1
    (lines,) = _raw_bodies(aws).values()
    assert {ln["body"]["vessel"] for ln in lines} == {"Salish", "Tacoma"}


def test_all_empty_night_flags_itself(aws, monkeypatch):
    fake = FakeWsf(rows_for={"Tacoma": [], "Walla Walla": [], "Salish": []})
    result = _run(monkeypatch, fake)
    assert result.get("HistoryEmptyNight") == 1


def test_backfill_writes_markers_and_suffixed_keys(aws, monkeypatch):
    fake = FakeWsf(rows_for={"Walla Walla": [ROW, ROW]})
    result = _run(
        monkeypatch, fake, {"mode": "backfill", "vessel": "Walla Walla", "years": [2002, 2003]}
    )
    assert result["rows_by_year"] == {2002: 2, 2003: 2}
    # 2002 starts at the verified data floor, not Jan 1.
    assert fake.calls[0] == ("Walla Walla", "2002-03-01", "2002-12-31")
    keys = list(_raw_bodies(aws))
    assert any("walla-walla-2002" in k for k in keys)
    assert any("walla-walla-2003" in k for k in keys)
    markers = aws["table"].scan()["Items"]
    assert {m["SK"] for m in markers} == {
        "BACKFILL#walla-walla#2002",
        "BACKFILL#walla-walla#2003",
    }
