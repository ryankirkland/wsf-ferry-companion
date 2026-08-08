import json

import pytest
from wsf_core import WsfApiError
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
        # Number of remaining calls (any upstream method) that should raise
        # a transient WsfApiError before returning real data - simulates the
        # isolated WSDOT 5xx / exhausted-transport-retry blips seen in prod.
        self.transient_failures = 0

    def _maybe_fail(self):
        if self.transient_failures > 0:
            self.transient_failures -= 1
            raise WsfApiError("simulated transient upstream failure", status=500)

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
        self._maybe_fail()
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


def test_upstream_false_passenger_only_flag_is_suppressed():
    # RouteID 8 (pt-key) carries vehicles - WSF's own fare tables prove it -
    # yet upstream routedetails says PassengerOnlyFlag=true. The quirk
    # override suppresses the flag for route 8 and honors it elsewhere.
    from datetime import UTC, date, datetime

    from wsf_ingest.pairs_builder import build_pairs_index

    mates = [
        {
            "DepartingTerminalID": 17,
            "DepartingDescription": "Port Townsend",
            "ArrivingTerminalID": 11,
            "ArrivingDescription": "Coupeville",
        },
        {
            "DepartingTerminalID": 20,
            "DepartingDescription": "Seattle",
            "ArrivingTerminalID": 21,
            "ArrivingDescription": "Genuine POF",
        },
    ]
    route_details = [
        {"RouteID": 8, "CrossingTime": "35", "ReservationFlag": True, "PassengerOnlyFlag": True},
        {"RouteID": 99, "CrossingTime": "10", "ReservationFlag": False, "PassengerOnlyFlag": True},
    ]
    index = build_pairs_index(
        mates=mates,
        route_details=route_details,
        pair_routes={(17, 11): 8, (20, 21): 99},
        terminals=[],
        schedule_meta={"ScheduleID": 1, "ScheduleName": "Test"},
        horizon_from=date(2026, 7, 24),
        horizon_days=2,
        now=datetime(2026, 7, 24, tzinfo=UTC),
    )
    by_dep = {p["dep"]: p for p in index["pairs"]}
    assert by_dep[17]["passenger_only"] is False  # suppressed: upstream-false
    assert by_dep[17]["reservable"] is True
    assert by_dep[20]["passenger_only"] is True  # any other route: honored


def test_full_rebuild_publishes_adjustments_calendar(aws, monkeypatch, fake):
    _run(monkeypatch, fake)
    doc = _get_json(aws, "data/adjustments.json")
    assert doc["v"] == 1 and doc["from"] == "2026-07-24"
    assert len(doc["adjustments"]) >= 100  # golden feed: 108 season rows, none past
    first = doc["adjustments"][0]
    assert set(first) == {
        "date",
        "route_id",
        "route_name",
        "terminal_id",
        "type",
        "tidal",
        "time_local",
    }
    assert first["date"] >= "2026-07-24"
    dates = [a["date"] for a in doc["adjustments"]]
    assert dates == sorted(dates)
    # The Aug-10 tidal cancel pair rides along with a real HH:MM.
    aug10 = [a for a in doc["adjustments"] if a["date"] == "2026-08-10"]
    assert aug10 and all(a["tidal"] and a["type"] == "cancel" for a in aug10)
    assert all(len(a["time_local"]) == 5 for a in doc["adjustments"])


def test_force_rebuild_ignores_unmoved_tokens(aws, monkeypatch, fake):
    _run(monkeypatch, fake)
    calls_after_first = fake.pair_calls
    counts = _run(monkeypatch, fake, {"mode": "force-rebuild"})
    assert counts["PairDatesPublished"] == 4  # full horizon again, tokens unchanged
    assert counts["FaresPublished"] == 38
    assert fake.pair_calls > calls_after_first


def test_isolated_upstream_blip_is_retried_not_fatal(aws, monkeypatch, fake, capsys):
    # 2026-08-08: a single HTTP 500 (and, separately, an exhausted transport
    # retry) mid-rebuild aborted the whole 532-call horizon rebuild and
    # tripped wsf-prod-schedule-refresh-errors. One blip among hundreds of
    # calls must not fail the run.
    monkeypatch.setattr(schedule_refresh.time, "sleep", lambda s: None)
    fake.transient_failures = 1
    counts = _run(monkeypatch, fake)
    assert counts["PairDatesPublished"] == 4  # full horizon still published
    assert fake.pair_calls == 5  # 4 real pair-dates + 1 retried-away failure
    assert "ScheduleFetchRetry" in capsys.readouterr().out


def test_retries_exhausted_still_raises(aws, monkeypatch, fake):
    # A genuine, sustained upstream outage must still fail loudly - retries
    # smooth over blips, they don't mask a real problem.
    monkeypatch.setattr(schedule_refresh.time, "sleep", lambda s: None)
    monkeypatch.setenv("UPSTREAM_FETCH_RETRIES", "2")
    fake.transient_failures = 3
    with pytest.raises(WsfApiError):
        _run(monkeypatch, fake)
