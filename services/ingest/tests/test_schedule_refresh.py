import json

import pytest
from wsf_ingest import schedule_refresh

DATA_BUCKET = "wsf-test-data"

# 2026-07-24T00:00 PDT - matches the golden envelope's TripDate.
SERVER_TODAY = "/Date(1784876400000-0700)/"


class FakeWsf:
    def __init__(self, route_envelope, mates, route_details, timeadj, tokens, fares_payload):
        self._env = route_envelope
        self._mates = mates
        self._route_details = route_details
        self._timeadj = timeadj
        self.tokens = tokens
        self._fares = fares_payload
        self.pair_calls = 0
        self.fares_calls = 0

    def cache_flush_date(self, sub_api):
        return self.tokens[sub_api]

    def valid_date_range(self, sub_api):
        return {"DateFrom": SERVER_TODAY, "DateThru": "/Date(1798272000000-0800)/"}

    def terminals_and_mates_raw(self, d):
        return self._mates

    def route_details_raw(self, d):
        return self._route_details

    def timeadj_raw(self):
        return self._timeadj

    def schedule_pair_raw(self, d, dep, arr):
        self.pair_calls += 1
        return self._env

    def fare_line_items_verbose_raw(self, d):
        self.fares_calls += 1
        return self._fares


@pytest.fixture
def fake(schedule_route_envelope, timeadj_rows_ingest, fares_verbose_ingest):
    mates = [
        {
            "DepartingTerminalID": 7,
            "DepartingDescription": "Seattle",
            "ArrivingTerminalID": 3,
            "ArrivingDescription": "Bainbridge Island",
        },
        {
            "DepartingTerminalID": 3,
            "DepartingDescription": "Bainbridge Island",
            "ArrivingTerminalID": 7,
            "ArrivingDescription": "Seattle",
        },
    ]
    route_details = [
        {
            "RouteID": 5,
            "RouteAbbrev": "sea-bi",
            "CrossingTime": "35",
            "ReservationFlag": False,
            "PassengerOnlyFlag": False,
        },
    ]
    return FakeWsf(
        schedule_route_envelope,
        mates,
        route_details,
        timeadj_rows_ingest,
        {"schedule": "S1", "fares": "F1"},
        fares_verbose_ingest,
    )


def _run(monkeypatch, fake, event=None):
    monkeypatch.setenv("HORIZON_DAYS", "2")
    monkeypatch.setenv("UPSTREAM_SPACING_S", "0")
    monkeypatch.setattr(schedule_refresh, "_client", fake)
    return schedule_refresh.lambda_handler(event or {}, None)


def _get_json(aws, key):
    return json.loads(aws["s3"].get_object(Bucket=DATA_BUCKET, Key=key)["Body"].read())


def test_full_rebuild_publishes_index_days_and_pair_items(aws, monkeypatch, fake):
    counts = _run(monkeypatch, fake)
    assert counts["PairDatesPublished"] == 4  # 2 pairs x 2 dates
    assert counts["FaresPublished"] == 38  # first run: no stored token yet

    index = _get_json(aws, "data/pairs/index.json")
    assert index["v"] == 1 and len(index["pairs"]) == 2
    sea_bi = next(p for p in index["pairs"] if p["dep"] == 7)
    assert sea_bi["route_id"] == 5
    assert sea_bi["crossing_min"] == 35
    assert sea_bi["slug"] == "seattle-bainbridge-island"

    day0 = _get_json(aws, "data/pairs/7-3/2026-07-24.json")
    assert day0["crossing_min"] == 35
    assert len(day0["sailings"]) == 23
    assert all(s["notes"] == [] for s in day0["sailings"])
    tail = [s for s in day0["sailings"] if s["after_midnight"]]
    assert len(tail) == 2  # the 00:15 / 01:35 next-calendar-day rows

    # Same envelope stubbed for date+1 -> every sailing deduped as tail-repeat.
    day1 = _get_json(aws, "data/pairs/7-3/2026-07-25.json")
    assert day1["sailings"] == []

    from boto3.dynamodb.conditions import Key

    resp = aws["table"].query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))
    assert resp["Count"] == 23
    first = resp["Items"][0]
    assert int(first["expires_at"]) == int(first["depart_ms"]) // 1000 + 6 * 3600


def test_second_run_with_same_tokens_noops(aws, monkeypatch, fake):
    _run(monkeypatch, fake)
    calls_after_first = fake.pair_calls
    counts = _run(monkeypatch, fake)
    assert counts["PairDatesPublished"] == 0
    assert fake.pair_calls == calls_after_first  # no upstream schedule refetch


def test_fares_publish_when_token_moves(aws, monkeypatch, fake):
    _run(monkeypatch, fake)
    assert fake.fares_calls == 1
    counts = _run(monkeypatch, fake)
    assert counts["FaresPublished"] == 0 and fake.fares_calls == 1  # token unchanged
    fake.tokens["fares"] = "F2"
    counts = _run(monkeypatch, fake)
    assert counts["FaresPublished"] == 38 and fake.fares_calls == 2
    muk_cl = _get_json(aws, "data/fares/14-5.json")
    adult = next(i for i in muk_cl["one_way"] if i["id"] == 1)
    assert adult["amount"] == "7.10"  # the LineItemLookup regression, end to end
    assert "retrieved_at" in muk_cl and muk_cl["source_token"] == "F2"


def test_today_refresh_logs_divergence(aws, monkeypatch, fake, capsys):
    _run(monkeypatch, fake)
    # Tamper with the served file: add a phantom sailing that the fresh pull lacks.
    key = "data/pairs/7-3/2026-07-24.json"
    doc = _get_json(aws, key)
    doc["sailings"].append({**doc["sailings"][0], "vessel_id": 999, "depart_ms": 1})
    aws["s3"].put_object(Bucket=DATA_BUCKET, Key=key, Body=json.dumps(doc).encode())

    counts = _run(monkeypatch, fake, {"mode": "today-refresh"})
    assert counts["PairDatesPublished"] == 2  # today only, both pairs
    out = capsys.readouterr().out
    assert "ScheduleDivergence" in out
    assert "[999, 1]" in out  # the phantom shows up as removed
