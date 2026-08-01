"""The Athena runner, which every published statistic passes through.

It was the only module in the analytics path with no test: a bug in the
type casting would corrupt every number on the site, and a bug in the
header-row strip would silently drop the first row of every result.
"""

import pytest
from wsf_analytics.athena import Athena, AthenaError


class FakeAthenaClient:
    """Enough of boto3's athena client to exercise the runner honestly."""

    def __init__(self, states=("SUCCEEDED",), pages=None, scanned=1000, reason=None):
        self.states = list(states)
        self.pages = pages or [_page([("n", "bigint")], [["1"]], header=True)]
        self.scanned = scanned
        self.reason = reason
        self.started = []
        self.poll_count = 0

    def start_query_execution(self, **kwargs):
        self.started.append(kwargs)
        return {"QueryExecutionId": "q-1"}

    def get_query_execution(self, QueryExecutionId):
        self.poll_count += 1
        state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        status = {"State": state}
        if self.reason:
            status["StateChangeReason"] = self.reason
        return {
            "QueryExecution": {"Status": status, "Statistics": {"DataScannedInBytes": self.scanned}}
        }

    def get_paginator(self, _name):
        pages = self.pages

        class Paginator:
            def paginate(self, **_kwargs):
                return iter(pages)

        return Paginator()


def _page(columns, rows, header=False):
    """Athena repeats the column names as row 0 of the FIRST page only."""
    data_rows = [{"Data": [{"VarCharValue": v} if v is not None else {} for v in r]} for r in rows]
    if header:
        head = {"Data": [{"VarCharValue": name} for name, _ in columns]}
        data_rows = [head, *data_rows]
    return {
        "ResultSet": {
            "Rows": data_rows,
            "ResultSetMetadata": {"ColumnInfo": [{"Name": n, "Type": t} for n, t in columns]},
        }
    }


def runner(client, poll_s=0):
    return Athena("db", "wg", client=client, poll_s=poll_s)


def test_waits_for_a_terminal_state_before_reading_results():
    client = FakeAthenaClient(states=["QUEUED", "RUNNING", "SUCCEEDED"])
    runner(client).query("SELECT 1")
    assert client.poll_count == 3  # never read results mid-flight


def test_a_failed_query_raises_with_the_reason():
    client = FakeAthenaClient(states=["FAILED"], reason="SYNTAX_ERROR: line 1:8")
    with pytest.raises(AthenaError, match="SYNTAX_ERROR"):
        runner(client).query("SELECT nope")


def test_a_cancelled_query_raises_rather_than_returning_nothing():
    # Silently returning [] would publish an empty statistic as if it were
    # a real measurement of zero.
    client = FakeAthenaClient(states=["CANCELLED"])
    with pytest.raises(AthenaError):
        runner(client).query("SELECT 1")


def test_the_header_row_is_stripped_from_the_first_page_only():
    columns = [("year", "bigint")]
    client = FakeAthenaClient(
        pages=[
            _page(columns, [["2002"], ["2003"]], header=True),
            # A later page opens with DATA; treating it as a header would
            # silently drop a year from the record.
            _page(columns, [["2004"]]),
        ]
    )
    rows = runner(client).query("SELECT year FROM history")
    assert [r["year"] for r in rows] == [2002, 2003, 2004]


def test_values_are_cast_to_their_athena_types():
    columns = [("n", "bigint"), ("pct", "double"), ("name", "varchar"), ("ok", "boolean")]
    client = FakeAthenaClient(
        pages=[_page(columns, [["3493725", "90.1", "Tacoma", "true"]], header=True)]
    )
    (row,) = runner(client).query("SELECT ...")
    assert row["n"] == 3493725 and isinstance(row["n"], int)
    assert row["pct"] == 90.1 and isinstance(row["pct"], float)
    assert row["name"] == "Tacoma"
    assert row["ok"] is True


def test_a_null_cell_stays_none_rather_than_becoming_zero():
    # p50 of an empty window is NULL; rendering it as 0 would claim every
    # sailing left exactly on time.
    columns = [("p50", "double")]
    client = FakeAthenaClient(pages=[_page(columns, [[None]], header=True)])
    (row,) = runner(client).query("SELECT p50")
    assert row["p50"] is None


def test_the_workgroup_and_database_are_sent_with_every_query():
    # The workgroup carries the enforced result location and the 2 GB scan
    # cutoff; a query submitted without it escapes both.
    client = FakeAthenaClient()
    runner(client).query("SELECT 1")
    (call,) = client.started
    assert call["WorkGroup"] == "wg"
    assert call["QueryExecutionContext"] == {"Database": "db"}


def test_bytes_scanned_accumulate_across_queries():
    client = FakeAthenaClient(scanned=25_000_000)
    athena = runner(client)
    athena.query("SELECT 1")
    athena.query("SELECT 2")
    assert athena.bytes_scanned == 50_000_000
