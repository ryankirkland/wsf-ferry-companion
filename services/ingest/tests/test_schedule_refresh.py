import json
from datetime import UTC, date, timedelta

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
        # Counted so a test can prove the debounce declines BEFORE any upstream
        # contact - these three run at the top of the handler.
        self.preflight_calls = 0

    def cache_flush_date(self, sub_api):
        self.preflight_calls += 1
        return self.tokens[sub_api]

    def valid_date_range(self, sub_api):
        self.preflight_calls += 1
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


def _run(monkeypatch, fake, event=None, rebuild_interval_h="0"):
    monkeypatch.setenv("HORIZON_DAYS", "2")
    monkeypatch.setenv("UPSTREAM_SPACING_S", "0")
    # Default 0 = no cadence gating, so the tests below exercise the CONTENT
    # gate they were written for. The cadence gate has its own tests.
    monkeypatch.setenv("FULL_REBUILD_MIN_INTERVAL_H", rebuild_interval_h)
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


def test_decision_log_reflects_token_gating(aws, monkeypatch, fake, capsys):
    _run(monkeypatch, fake)
    first_decision = json.loads(capsys.readouterr().out.strip().splitlines()[0])
    assert first_decision["ScheduleRefreshDecision"]["will_rebuild_horizon"] is True

    _run(monkeypatch, fake)
    second_decision = json.loads(capsys.readouterr().out.strip().splitlines()[0])
    assert second_decision["ScheduleRefreshDecision"]["schedule_token_moved"] is False
    assert second_decision["ScheduleRefreshDecision"]["will_rebuild_horizon"] is False


def test_schedule_token_churn_with_identical_content_publishes_nothing(aws, monkeypatch, fake):
    """WSDOT flips the schedule token on essentially every run; the content
    gate must absorb the churn instead of re-PUTting 532 identical files."""
    _run(monkeypatch, fake)
    calls_after_first = fake.pair_calls

    fake.tokens["schedule"] = "S2"
    counts = _run(monkeypatch, fake)
    assert counts["PairDatesPublished"] == 0
    assert counts["PairDatesUnchanged"] == 4
    assert fake.pair_calls == 2 * calls_after_first  # refetched (fetch gate is separate)

    # The churned token was stored: the same token now takes the cheap gate.
    counts = _run(monkeypatch, fake)
    assert counts["PairDatesPublished"] == 0
    assert counts["PairDatesUnchanged"] == 0
    assert fake.pair_calls == 2 * calls_after_first


def test_schedule_token_change_with_content_change_republishes(aws, monkeypatch, fake):
    import copy

    _run(monkeypatch, fake)

    env = copy.deepcopy(fake._env)
    env["TerminalCombos"][0]["Times"][0]["VesselName"] = "Renamed Vessel"
    fake._env = env
    fake.tokens["schedule"] = "S2"
    counts = _run(monkeypatch, fake)
    # One pair's day-0 file changes; its day-1 file dedupes to empty either
    # way, and the other pair is untouched.
    assert counts["PairDatesPublished"] == 1
    assert counts["PairDatesUnchanged"] == 3

    docs = [_get_json(aws, f"data/pairs/{d}-{a}/2026-07-24.json") for d, a in [(7, 3), (3, 7)]]
    assert any(any(s["vessel"] == "Renamed Vessel" for s in doc["sailings"]) for doc in docs)


def test_fares_token_churn_absorbed_and_real_change_published(
    aws, monkeypatch, fake, fares_verbose_ingest
):
    _run(monkeypatch, fake)
    assert fake.fares_calls == 1
    muk_cl = _get_json(aws, "data/fares/14-5.json")
    adult = next(i for i in muk_cl["one_way"] if i["id"] == 1)
    assert adult["amount"] == "7.10"  # the LineItemLookup regression, end to end
    assert "retrieved_at" in muk_cl and muk_cl["source_token"] == "F1"

    counts = _run(monkeypatch, fake)
    assert counts["FaresPublished"] == 0 and fake.fares_calls == 1  # token unchanged

    # Token churn with identical fares: fetched for comparison, nothing
    # republished, and the served file keeps its original provenance.
    fake.tokens["fares"] = "F2"
    counts = _run(monkeypatch, fake)
    assert counts["FaresPublished"] == 0
    assert counts["FaresUnchanged"] == 38
    assert fake.fares_calls == 2
    assert _get_json(aws, "data/fares/14-5.json")["source_token"] == "F1"

    # A real fare change republishes exactly the affected pair.
    import copy

    changed = copy.deepcopy(fares_verbose_ingest)
    combo0 = changed["TerminalComboVerbose"][0]
    changed["LineItems"][0][0]["Amount"] = 99.75
    fake._fares = changed
    fake.tokens["fares"] = "F3"
    counts = _run(monkeypatch, fake)
    assert counts["FaresPublished"] == 1
    assert counts["FaresUnchanged"] == 37
    target = _get_json(
        aws,
        f"data/fares/{combo0['DepartingTerminalID']}-{combo0['ArrivingTerminalID']}.json",
    )
    assert target["source_token"] == "F3"


def test_today_refresh_logs_divergence(aws, monkeypatch, fake, capsys):
    _run(monkeypatch, fake)
    # Tamper with the served file: add a phantom sailing that the fresh pull lacks.
    key = "data/pairs/7-3/2026-07-24.json"
    doc = _get_json(aws, key)
    doc["sailings"].append({**doc["sailings"][0], "vessel_id": 999, "depart_ms": 1})
    aws["s3"].put_object(Bucket=DATA_BUCKET, Key=key, Body=json.dumps(doc).encode())

    counts = _run(monkeypatch, fake, {"mode": "today-refresh"})
    # Only the tampered pair gets repaired; the untouched pair's served bytes
    # already match the fresh build and are skipped.
    assert counts["PairDatesPublished"] == 1
    assert counts["PairDatesUnchanged"] == 1
    out = capsys.readouterr().out
    assert "ScheduleDivergence" in out
    assert "[999, 1]" in out  # the phantom shows up as removed
    fresh = _get_json(aws, key)
    assert all(s["vessel_id"] != 999 for s in fresh["sailings"])  # repaired


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


def test_pair_items_are_written_once_then_gated(aws, monkeypatch, fake):
    """~134,000 write units/day were identical rewrites (audit 2026-08-23):
    today+tomorrow x 38 pairs x ~188 runs, 99.85% byte-identical."""
    from boto3.dynamodb.conditions import Key

    _run(monkeypatch, fake)
    first = aws["table"].query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))
    assert first["Count"] == 23

    # Token churn with identical content: the 99.85% case. The horizon is
    # rebuilt and every pair-date refetched, but nothing actually changed.
    writes = {"n": 0}
    real_batch = aws["table"].batch_writer

    def counting_batch(*args, **kwargs):
        writes["n"] += 1
        return real_batch(*args, **kwargs)

    aws["table"].batch_writer = counting_batch
    fake.tokens["schedule"] = "S2"
    counts = _run(monkeypatch, fake)

    assert counts["PairDatesUnchanged"] == 4, "the horizon really was rebuilt"
    assert writes["n"] == 0, "unchanged sailings must not be rewritten"
    # ...and the items are still there for the alert-citation join.
    again = aws["table"].query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))
    assert again["Count"] == 23


def test_items_are_written_even_when_the_s3_file_is_gated(aws, monkeypatch, fake):
    """The scenario the separate namespace exists for.

    A date's S3 file is published the moment it ENTERS the 14-day horizon,
    days before that date reaches the today/tomorrow window where DynamoDB
    items are written. So by then its S3 hash is already recorded. If the
    two shared one gate, the items would never be written at all - and the
    alert-citation join reads them.

    Simulated exactly: keep the S3 gate entries from a real run, drop the
    item-gate entries and the items themselves, then churn the token so the
    horizon rebuilds with identical content. The S3 publishes are all
    gated; the items must still come back."""
    from boto3.dynamodb.conditions import Key
    from wsf_ingest import schedule_refresh

    table = aws["table"]
    _run(monkeypatch, fake)

    hashes = schedule_refresh._load_hashes(table)
    s3_only = {k: v for k, v in hashes.items() if not k.startswith(schedule_refresh._ITEMS_PREFIX)}
    assert len(s3_only) < len(hashes), "the run should have recorded item-gate entries"
    schedule_refresh._save_hashes(table, s3_only)

    existing = table.query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))["Items"]
    with table.batch_writer() as batch:
        for item in existing:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    assert table.query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))["Count"] == 0

    fake.tokens["schedule"] = "S2"
    counts = _run(monkeypatch, fake)

    assert counts["PairDatesPublished"] == 0, "every S3 file was gated, as intended"
    resp = table.query(KeyConditionExpression=Key("PK").eq("PAIR#0007#0003"))
    assert resp["Count"] == 23, "items must be rewritten even when the S3 gate says skip"


def test_item_hashes_are_pruned_once_the_day_passes(aws):
    """Unpruned, this map grows daily inside ONE DynamoDB item and
    eventually trips the 400 KB limit, which stops publishing outright."""
    from datetime import date as _date

    from wsf_ingest import schedule_refresh

    p = schedule_refresh._ITEMS_PREFIX
    hashes = {
        f"{p}7-3/2026-07-20": "old",
        f"{p}7-3/2026-07-24": "today",
        f"{p}7-3/2026-07-25": "tomorrow",
        "data/pairs/index.json": "keep-me",
        f"{p}7-3/not-a-date": "keep-me-too",
    }
    dropped = schedule_refresh._prune_item_hashes(hashes, _date(2026, 7, 24))

    assert dropped == 1
    assert f"{p}7-3/2026-07-20" not in hashes
    assert f"{p}7-3/2026-07-24" in hashes and f"{p}7-3/2026-07-25" in hashes
    assert hashes["data/pairs/index.json"] == "keep-me", "S3 gate entries are untouched"
    assert hashes[f"{p}7-3/not-a-date"] == "keep-me-too", "unparseable keys are left alone"


def test_full_rebuild_is_rate_limited_not_token_driven(aws, monkeypatch, fake):
    """WSDOT moves the schedule token on essentially every check - measured
    96/96 runs on 2026-08-23 - so rebuilding on the token meant 538 upstream
    calls every 15 minutes to learn nothing: ~52,000 requests/day and the
    largest Lambda consumer in the account."""
    _run(monkeypatch, fake, rebuild_interval_h="3")
    calls_after_first = fake.pair_calls

    # Token churns again inside the window: no refetch at all.
    fake.tokens["schedule"] = "S2"
    counts = _run(monkeypatch, fake, rebuild_interval_h="3")
    assert fake.pair_calls == calls_after_first, "no upstream refetch inside the window"
    assert counts["PairDatesPublished"] == 0
    assert counts["PairDatesUnchanged"] == 0


def test_force_rebuild_ignores_the_cadence(aws, monkeypatch, fake):
    _run(monkeypatch, fake, rebuild_interval_h="24")
    calls_after_first = fake.pair_calls

    _run(monkeypatch, fake, event={"mode": "force-rebuild"}, rebuild_interval_h="24")
    assert fake.pair_calls > calls_after_first, "an operator force must always rebuild"


def test_rebuild_due_reads_the_stamp():
    from datetime import datetime as _dt

    from wsf_ingest import schedule_refresh

    now = _dt(2026, 8, 24, 12, 0, tzinfo=UTC)
    monkey_h = schedule_refresh._full_rebuild_interval_h()
    assert monkey_h > 0  # the deployed default is a real interval

    assert schedule_refresh._full_rebuild_due(None, now) is True, "never rebuilt: go"
    assert schedule_refresh._full_rebuild_due("not-a-timestamp", now) is True, "unparseable: go"
    fresh = (now - timedelta(minutes=30)).isoformat()
    assert schedule_refresh._full_rebuild_due(fresh, now) is False
    stale = (now - timedelta(hours=9)).isoformat()
    assert schedule_refresh._full_rebuild_due(stale, now) is True


def test_horizon_roll_does_not_erase_the_rebuild_stamp(aws, monkeypatch, fake):
    """Three call sites write the HORIZON item and only one knows the
    stamp; a put_item from either of the others reads as 'never rebuilt'
    and sends the next run straight back to rebuilding on every token."""
    from wsf_ingest import schedule_refresh

    table = aws["table"]
    _run(monkeypatch, fake, rebuild_interval_h="3")
    stamped = table.get_item(Key={"PK": schedule_refresh.META_PK, "SK": "HORIZON#pairs"})["Item"]
    assert "last_full_utc" in stamped

    schedule_refresh._write_horizon(table, date(2026, 7, 25))
    after = table.get_item(Key={"PK": schedule_refresh.META_PK, "SK": "HORIZON#pairs"})["Item"]
    assert after["last_full_utc"] == stamped["last_full_utc"], "the stamp must survive"
    assert after["horizon_from"] == "2026-07-25", "and the roll must still take effect"


def test_today_refresh_is_debounced(aws, monkeypatch, fake):
    """The alerts poller invokes this on ANY bulletin change, and WSF rewrites
    live delay bulletins every few minutes as boats fall behind: ~10
    invocations/hour re-fetching all 38 of today's pairs, ~9,100 upstream
    calls/day. Over six hours they published nothing, and the
    ScheduleDivergence instrument found nothing in three days."""
    _run(monkeypatch, fake)  # seeds the horizon
    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    calls_after_first = fake.pair_calls

    # A second alerts change moments later must not re-fetch anything.
    counts = _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    assert fake.pair_calls == calls_after_first, "debounced run must not touch upstream"
    assert counts["PairDatesUnchanged"] == 0


def test_the_debounce_declines_before_any_upstream_call(aws, monkeypatch, fake):
    """Three WSDOT calls (two cacheflushdate, one validdaterange) happen at
    the top of the handler. Deciding after them would still cost ~720
    requests/day on runs that do nothing."""
    _run(monkeypatch, fake)
    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    before = fake.preflight_calls
    assert before > 0, "the fake should have recorded the handler's preflight calls"

    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    assert fake.preflight_calls == before, (
        "a declined run must not even reach cacheflushdate/validdaterange"
    )


def test_today_refresh_runs_again_once_the_window_passes(aws, monkeypatch, fake):
    _run(monkeypatch, fake)
    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    calls = fake.pair_calls

    monkeypatch.setenv("TODAY_REFRESH_MIN_INTERVAL_MIN", "0")
    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="0")
    assert fake.pair_calls > calls, "the window must reopen"


def test_today_refresh_due_reads_the_stamp():
    from datetime import datetime as _dt

    from wsf_ingest import schedule_refresh

    now = _dt(2026, 8, 24, 12, 0, tzinfo=UTC)
    assert schedule_refresh._today_refresh_due(None, now) is True
    assert schedule_refresh._today_refresh_due("not-a-timestamp", now) is True
    assert (
        schedule_refresh._today_refresh_due((now - timedelta(minutes=5)).isoformat(), now) is False
    )
    assert (
        schedule_refresh._today_refresh_due((now - timedelta(minutes=75)).isoformat(), now) is True
    )


def test_the_two_cadence_stamps_do_not_clobber_each_other(aws, monkeypatch, fake):
    """Four call sites write the HORIZON item and each knows at most one
    stamp; a put_item from any of them would erase the other and restore the
    old traffic."""
    from wsf_ingest import schedule_refresh

    table = aws["table"]
    _run(monkeypatch, fake, rebuild_interval_h="3")
    _run(monkeypatch, fake, event={"mode": "today-refresh"}, rebuild_interval_h="3")

    item = table.get_item(Key={"PK": schedule_refresh.META_PK, "SK": "HORIZON#pairs"})["Item"]
    assert "last_full_utc" in item, "the rebuild stamp was erased"
    assert "last_today_utc" in item, "the today-refresh stamp was erased"
