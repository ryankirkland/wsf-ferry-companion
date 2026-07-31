import json

import pytest
from wsf_analytics import stats

PAIRS_INDEX = {
    "v": 1,
    "pairs": [
        {
            "dep": 3,
            "arr": 7,
            "dep_name": "Bainbridge Island",
            "arr_name": "Seattle",
            "slug": "bainbridge-island-seattle",
            "route_id": 5,
        }
    ],
}


def win(n, ontime, p50=2.0, p90=12.0):
    return {"n_win": n, "ontime_win": ontime, "p50_win": p50, "p90_win": p90}


def all_time(n, ontime, p50=3.0, p90=15.0):
    return {"n_all": n, "ontime_all": ontime, "p50_all": p50, "p90_all": p90}


def both(n_win, ontime_win, n_all=50000, ontime_all=88.0):
    return {**win(n_win, ontime_win), **all_time(n_all, ontime_all)}


class FakeAthena:
    """Dispatch on the query's shape - the SQL itself is exercised against
    real Athena in the deployed verification, not here."""

    def __init__(self, rows: dict, **_):
        self.rows = rows
        self.bytes_scanned = 1234
        self.seen = []

    def query(self, sql: str):
        if "GROUP BY" not in sql:
            key = "bounds" if "max(service_date)" in sql else "sailed"
        elif "count(DISTINCT vessel_name) AS vessels" in sql:
            key = "recent_days"
        elif "substr(depart_hhmm_local" in sql:
            key = "hours"
        elif "depart_hhmm_local AS hhmm" in sql:
            key = "slots"
        elif "GROUPING SETS" in sql:
            key = "system"
        elif "AS season" in sql:
            key = "seasons"
        elif "SELECT vessel_name," in sql:
            key = "vessels"
        elif "month(service_date) AS month" in sql:
            key = "months"
        else:
            key = "pairs"
        self.seen.append(key)
        return self.rows.get(key, [])


def install(monkeypatch, rows):
    holder = {}

    def factory(**kwargs):
        holder["athena"] = FakeAthena(rows, **kwargs)
        return holder["athena"]

    monkeypatch.setattr(stats, "Athena", factory)
    return holder


BASE_ROWS = {
    "bounds": [
        {"through": "2026-07-30", "since": "2002-03-01", "rows_total": 3493725, "vessels": 30}
    ],
    "slots": [
        {"dep": 3, "arr": 7, "hhmm": "06:20", **both(120, 94.0)},
        {"dep": 3, "arr": 7, "hhmm": "07:55", **both(4, 25.0)},  # too thin to trust
    ],
    "hours": [{"dep": 3, "arr": 7, "hh": "07", **both(310, 81.0)}],
    "pairs": [{"dep": 3, "arr": 7, **both(2400, 91.0)}],
    "seasons": [{"dep": 3, "arr": 7, "season": "summer", "n": 800, "ontime": 89.0, "p90": 14.0}],
    "system": [
        {"year": None, **both(400000, 90.0)},
        {"year": 2026, **both(83944, 90.5)},
    ],
    "vessels": [
        {"vessel_name": "Tacoma", **both(900, 96.0)},
        {"vessel_name": "Kaleetan", **both(50, 99.9)},  # sample too small to crown
    ],
    "months": [
        {"month": 1, "n": 100, "ontime": 92.0, "p90": 11.0},
        {"month": 8, "n": 100, "ontime": 84.0, "p90": 19.0},
    ],
    "recent_days": [
        {"service_date": "2026-07-29", "n": 900, "vessels": 20},
        {"service_date": "2026-07-30", "n": 100, "vessels": 4},  # collection gap
    ],
    "sailed": [],
}


@pytest.fixture
def seeded(aws):
    aws["s3"].put_object(
        Bucket="wsf-test-data",
        Key="data/pairs/index.json",
        Body=json.dumps(PAIRS_INDEX).encode(),
    )
    return aws


def read_json(aws, key):
    return json.loads(aws["s3"].get_object(Bucket="wsf-test-data", Key=key)["Body"].read())


def test_publishes_summary_and_pair_contracts(seeded, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    result = stats.lambda_handler({"trigger": "test"}, None)
    assert result["StatsPairsWritten"] == 1

    summary = read_json(seeded, "data/stats/summary.json")
    assert summary["data_through"] == "2026-07-30"
    assert summary["window"] == {"label": "last 90 days", "from": "2026-05-02", "to": "2026-07-30"}
    assert summary["system"]["primary"] == {
        "n": 400000,
        "ontime_pct": 90.0,
        "p50": 2.0,
        "p90": 12.0,
    }
    assert summary["coverage"]["sailings"] == 3493725

    pair = read_json(seeded, "data/stats/pairs/3-7.json")
    assert pair["pair"]["slug"] == "bainbridge-island-seattle"
    assert pair["overall"]["primary"]["n"] == 2400
    assert [s["hhmm"] for s in pair["slots"]] == ["06:20", "07:55"]


def test_thin_slot_degrades_to_its_hour_bucket_and_says_so(seeded, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    result = stats.lambda_handler({}, None)
    pair = read_json(seeded, "data/stats/pairs/3-7.json")
    thin = next(s for s in pair["slots"] if s["hhmm"] == "07:55")
    healthy = next(s for s in pair["slots"] if s["hhmm"] == "06:20")

    assert thin["basis"] == "hour"
    assert thin["primary"]["ontime_pct"] == 81.0  # the 07:00 bucket, not the 4-sailing slot
    # The slot's own thin numbers survive alongside, so the page can say
    # exactly how little evidence the slot itself carries.
    assert thin["slot_window"] == {"n": 4, "ontime_pct": 25.0, "p50": 2.0, "p90": 12.0}
    assert healthy["basis"] == "slot" and healthy["primary"]["ontime_pct"] == 94.0
    assert healthy["slot_window"] == healthy["primary"]
    assert result["StatsSlotsDegraded"] == 1


def test_superlatives_ignore_small_samples(seeded, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    stats.lambda_handler({}, None)
    summary = read_json(seeded, "data/stats/summary.json")
    # Kaleetan's 99.9% rides on 50 sailings; Tacoma earns it on 900.
    assert summary["superlatives"]["most_punctual_vessel"]["vessel_name"] == "Tacoma"
    assert summary["superlatives"]["roughest_month"]["month"] == 8


def test_collection_gap_days_are_flagged_not_averaged_in(seeded, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    stats.lambda_handler({}, None)
    summary = read_json(seeded, "data/stats/summary.json")
    assert [d["service_date"] for d in summary["coverage"]["thin_days"]] == ["2026-07-30"]


def test_empty_history_refuses_to_publish(seeded, monkeypatch):
    install(monkeypatch, {**BASE_ROWS, "bounds": [{"through": None}]})
    with pytest.raises(RuntimeError):
        stats.lambda_handler({}, None)
    with pytest.raises(seeded["s3"].exceptions.NoSuchKey):
        seeded["s3"].get_object(Bucket="wsf-test-data", Key="data/stats/summary.json")


def test_retired_pair_stays_out_of_the_page_set(seeded, monkeypatch):
    rows = {**BASE_ROWS, "pairs": BASE_ROWS["pairs"] + [{"dep": 7, "arr": 19, **both(500, 70.0)}]}
    install(monkeypatch, rows)
    result = stats.lambda_handler({}, None)
    assert result["StatsPairsWritten"] == 1  # Sidney B.C. has no live pair page
    keys = [
        o["Key"]
        for o in seeded["s3"].list_objects_v2(Bucket="wsf-test-data", Prefix="data/stats/pairs/")[
            "Contents"
        ]
    ]
    assert keys == ["data/stats/pairs/3-7.json"]


def test_cancellations_carry_their_window_and_caveat(seeded, monkeypatch):
    install(monkeypatch, BASE_ROWS)
    stats.lambda_handler({}, None)
    summary = read_json(seeded, "data/stats/summary.json")
    cancellations = summary["cancellations"]
    assert cancellations["tracking_since"] == "2026-07-29"
    assert cancellations["window"] == {"from": "2026-07-29", "to": "2026-07-30"}
    assert "floor" in cancellations["note"]
