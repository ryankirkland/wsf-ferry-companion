from datetime import timedelta
from decimal import Decimal

from wsf_core import VesselLocation
from wsf_ingest.ddb import FleetWriter


def _fleet(rows):
    return [VesselLocation.model_validate(r) for r in rows]


def test_dedup_writes_only_changed(aws, vessellocations_rows):
    fleet = _fleet(vessellocations_rows)
    writer = FleetWriter(aws["table"])

    assert writer.write_changed(fleet) == 21  # cold cache: everything writes
    assert writer.write_changed(fleet) == 0  # unchanged TimeStamps: nothing

    moved = fleet[0].model_copy(update={"source_ts": fleet[0].source_ts + timedelta(seconds=15)})
    assert writer.write_changed([moved, *fleet[1:]]) == 1


def test_item_shape(aws, vessellocations_rows):
    fleet = _fleet(vessellocations_rows)
    FleetWriter(aws["table"]).write_changed(fleet)

    yakima = aws["table"].get_item(Key={"PK": "FLEET", "SK": "VESSEL#0038"})["Item"]
    assert yakima["name"] == "Yakima"
    assert isinstance(yakima["lat"], Decimal)
    assert yakima["source_ts_utc"].endswith("Z")
    assert "arr_terminal_id" not in yakima  # semantic null omitted, not stored


def test_meta_item(aws, vessellocations_rows):
    writer = FleetWriter(aws["table"])
    writer.write_meta(polls_ok=3, polls_failed=1, last_error="boom")
    meta = aws["table"].get_item(Key={"PK": "META", "SK": "POLLER#vessellocations"})["Item"]
    assert meta["polls_ok"] == 3
    assert meta["last_error"] == "boom"
    assert "last_success_utc" in meta
