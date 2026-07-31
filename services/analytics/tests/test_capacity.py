import json

from wsf_analytics import capacity

# 2026-07-31 06:25 PDT.
DEPART = "/Date(1785504300000-0700)/"


class FakeWsf:
    def __init__(self, rows):
        self.rows = rows

    def terminal_sailing_space_raw(self):
        return self.rows


def terminal(terminal_id=3, arrivals=(7,), drive_up=20, color="#FFFF00", cancelled=False):
    return {
        "TerminalID": terminal_id,
        "TerminalName": "Bainbridge Island",
        "DepartingSpaces": [
            {
                "Departure": DEPART,
                "IsCancelled": cancelled,
                "VesselID": 2,
                "VesselName": "Chelan",
                "MaxSpaceCount": 120,
                "SpaceForArrivalTerminals": [
                    {
                        "TerminalID": terminal_id,
                        "DriveUpSpaceCount": drive_up,
                        "DriveUpSpaceHexColor": color,
                        "ReservableSpaceCount": None,
                        "MaxSpaceCount": 120,
                        "ArrivalTerminalIDs": list(arrivals),
                    }
                ],
            }
        ],
    }


def published(aws):
    body = aws["s3"].get_object(Bucket="wsf-test-data", Key="data/capacity.json")["Body"].read()
    return json.loads(body)


def test_reporting_terminals_archive(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([{"TerminalID": 7}, {"TerminalID": 3}]))
    result = capacity.lambda_handler({}, None)
    assert result["terminals"] == 2
    assert result["key"].startswith("raw/terminalsailingspace/dt=")


def test_overnight_empty_still_archives_and_publishes(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([]))
    result = capacity.lambda_handler({}, None)
    assert result["terminals"] == 0
    assert result["key"] is not None  # the [] itself is evidence
    # A fresh empty document beats a stale populated one: the page must be
    # able to say "nothing reporting right now" with a current timestamp.
    doc = published(aws)
    assert doc["pairs"] == {} and doc["reporting_terminals"] == []
    assert doc["generated_at"]


def test_contract_is_keyed_by_pair(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([terminal(3, arrivals=(7,))]))
    capacity.lambda_handler({}, None)
    doc = published(aws)
    assert list(doc["pairs"]) == ["3-7"]
    (sailing,) = doc["pairs"]["3-7"]
    assert sailing["vessel"] == "Chelan"
    assert sailing["drive_up"] == 20
    assert sailing["level"] == "filling"  # WSF's own yellow, not our arithmetic
    assert sailing["max_space"] == 120
    assert sailing["reservable"] is None
    assert sailing["cancelled"] is False
    assert doc["reporting_terminals"] == [3]


def test_one_sailing_serving_two_destinations_lands_on_both_pairs(aws, monkeypatch):
    # Anacortes -> Lopez and -> Shaw can be the same physical departure.
    monkeypatch.setattr(capacity, "_client", FakeWsf([terminal(1, arrivals=(13, 18))]))
    capacity.lambda_handler({}, None)
    doc = published(aws)
    assert sorted(doc["pairs"]) == ["1-13", "1-18"]


def test_unknown_colour_degrades_to_no_level(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([terminal(3, color="#123456")]))
    capacity.lambda_handler({}, None)
    (sailing,) = published(aws)["pairs"]["3-7"]
    assert sailing["level"] is None  # never guess a judgment WSF didn't publish
    assert sailing["drive_up"] == 20  # the count is still real


def test_cancelled_departure_is_passed_through(aws, monkeypatch):
    monkeypatch.setattr(capacity, "_client", FakeWsf([terminal(3, cancelled=True)]))
    result = capacity.lambda_handler({}, None)
    (sailing,) = published(aws)["pairs"]["3-7"]
    assert sailing["cancelled"] is True
    assert result["pairs"] == 1
