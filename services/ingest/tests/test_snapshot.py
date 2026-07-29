from datetime import timedelta

from wsf_core import VesselLocation
from wsf_ingest.snapshot import build_snapshot


def test_snapshot_from_golden_sample(vessellocations_rows):
    fleet = [VesselLocation.model_validate(r) for r in vessellocations_rows]
    now = max(v.source_ts for v in fleet) + timedelta(seconds=10)
    snap = build_snapshot(fleet, now)

    assert snap["v"] == 1
    assert snap["generated_at"].endswith("Z")
    assert len(snap["vessels"]) == 21

    by_name = {v["name"]: v for v in snap["vessels"]}
    assert by_name["Sealth"]["state"] == "stale"
    assert by_name["Sealth"]["age_s"] > 300
    assert by_name["Tokitae"]["state"] == "yard"
    assert by_name["Chimacum"]["state"] == "underway"
    assert by_name["Chimacum"]["eta"].endswith("Z")
    assert by_name["Chimacum"]["left"].endswith("Z")
    assert by_name["Yakima"]["state"] == "docked"
    assert by_name["Yakima"]["arr"] is None  # semantic null passes through

    # Out-of-service boats sort last (sort_seq 9999) but are present - honesty rule.
    assert snap["vessels"][-1]["insvc"] is False


def test_snapshot_is_json_compact_and_small(vessellocations_rows):
    import json

    fleet = [VesselLocation.model_validate(r) for r in vessellocations_rows]
    body = json.dumps(build_snapshot(fleet), separators=(",", ":"))
    assert len(body) < 15_000  # the public contract stays lightweight
