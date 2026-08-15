import json

from wsf_core import TerminalLocation, VesselDim
from wsf_ingest import dims

DATA_BUCKET = "wsf-test-data"


class FakeWsf:
    def __init__(self, vessel_rows, terminal_rows, tokens):
        self._vessels = vessel_rows
        self._terminals = terminal_rows
        self._tokens = tokens  # sub_api -> token

    def cache_flush_date(self, sub_api):
        return self._tokens[sub_api]

    def vessel_dims_raw(self):
        return self._vessels

    def vessel_dims(self):
        return [VesselDim.from_verbose(r) for r in self._vessels]

    def terminal_locations_raw(self):
        return self._terminals

    def terminal_locations(self):
        return [TerminalLocation.model_validate(r) for r in self._terminals]


def _run(monkeypatch, fake):
    monkeypatch.setattr(dims, "_client", fake)
    return dims.lambda_handler({}, None)


def test_first_run_publishes_both(aws, monkeypatch, vesselverbose_rows, terminallocations_rows):
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    result = _run(monkeypatch, fake)
    assert sorted(result["refreshed"]) == ["/data/terminals.json", "/data/vessels.json"]

    terms = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/terminals.json")["Body"].read()
    )
    assert len(terms["terminals"]) == 21  # 20 real + synthetic Eagle Harbor
    eah = next(t for t in terms["terminals"] if t["id"] == 122)
    assert eah["synthetic"] is True and eah["abbrev"] == "EAH"

    vessels = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/vessels.json")["Body"].read()
    )
    assert len(vessels["vessels"]) == 21
    assert all(v["class"] for v in vessels["vessels"])


def test_unchanged_tokens_publish_nothing(
    aws, monkeypatch, vesselverbose_rows, terminallocations_rows
):
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    _run(monkeypatch, fake)
    assert _run(monkeypatch, fake)["refreshed"] == []


def test_token_churn_with_identical_content_publishes_nothing(
    aws, monkeypatch, vesselverbose_rows, terminallocations_rows
):
    """WSDOT flips the terminals cacheflushdate on essentially every poll
    while the content stays identical; the content gate must absorb that
    instead of republishing and invalidating 96 times a day."""
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    _run(monkeypatch, fake)

    fake._tokens["terminals"] = "B2"
    result = _run(monkeypatch, fake)
    assert result["refreshed"] == []
    assert result["token_churn"] == 1

    # the churned token was stored: the same token now takes the cheap gate
    result = _run(monkeypatch, fake)
    assert result["refreshed"] == []
    assert result["token_churn"] == 0


def test_token_change_with_content_change_refreshes_one(
    aws, monkeypatch, vesselverbose_rows, terminallocations_rows
):
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    _run(monkeypatch, fake)

    renamed = [dict(r) for r in terminallocations_rows]
    renamed[0] = {**renamed[0], "TerminalName": "Renamed Terminal"}
    fake._terminals = renamed
    fake._tokens["terminals"] = "B2"
    result = _run(monkeypatch, fake)
    assert result["refreshed"] == ["/data/terminals.json"]
    assert result["token_churn"] == 0

    doc = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/terminals.json")["Body"].read()
    )
    assert any(t["name"] == "Renamed Terminal" for t in doc["terminals"])


def test_force_rebuild_republishes_without_a_token_change(
    aws, monkeypatch, vesselverbose_rows, terminallocations_rows
):
    """Shipping a new field in vessels.json cannot wait for WSDOT to flush
    their cache, which may be weeks away."""
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    monkeypatch.setattr(dims, "_client", fake)

    assert dims.lambda_handler({}, None)["refreshed"]  # first run stores tokens
    assert dims.lambda_handler({}, None)["refreshed"] == []  # token unchanged
    assert sorted(dims.lambda_handler({"mode": "force-rebuild"}, None)["refreshed"]) == [
        "/data/terminals.json",
        "/data/vessels.json",
    ]


def test_vessels_json_carries_the_mirrored_class_drawing(
    aws, monkeypatch, vesselverbose_rows, terminallocations_rows
):
    fake = FakeWsf(vesselverbose_rows, terminallocations_rows, {"vessels": "A", "terminals": "B"})
    monkeypatch.setattr(dims, "_client", fake)
    dims.lambda_handler({}, None)
    doc = json.loads(
        aws["s3"].get_object(Bucket=DATA_BUCKET, Key="data/vessels.json")["Body"].read()
    )
    for vessel in doc["vessels"]:
        assert vessel["drawing"].startswith("/assets/vessels/")
        assert vessel["drawing"].endswith(".png")
