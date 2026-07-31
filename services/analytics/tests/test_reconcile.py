import gzip
import json
from datetime import date

from wsf_analytics import reconcile

# 2026-07-30 06:10 and 07:55 PDT.
T0610 = "/Date(1785417000000-0700)/"
T0755 = "/Date(1785423300000-0700)/"


def schedule_line(fetched_at, times, day="2026-07-30", pair=(3, 7)):
    return json.dumps(
        {
            "fetched_at": fetched_at,
            "status": 200,
            "body": {
                "date": day,
                "pair": list(pair),
                "schedule": {
                    "TerminalCombos": [
                        {
                            "DepartingTerminalID": pair[0],
                            "ArrivingTerminalID": pair[1],
                            "Times": [{"DepartingTime": t} for t in times],
                        }
                    ]
                },
            },
        }
    )


def put_schedule(aws, lines, dt="2026-07-30", name="0500.ndjson.gz"):
    aws["s3"].put_object(
        Bucket="wsf-test-raw",
        Key=f"raw/schedule_refresh/dt={dt}/{name}",
        Body=gzip.compress(("\n".join(lines) + "\n").encode()),
    )


def test_last_snapshot_of_the_day_wins(aws):
    put_schedule(
        aws,
        [schedule_line("2026-07-29T14:00:00+00:00", [T0610])],
        name="0001.ndjson.gz",
    )
    put_schedule(
        aws,
        [schedule_line("2026-07-30T16:00:00+00:00", [T0610, T0755])],
        name="0002.ndjson.gz",
    )
    slots = reconcile.scheduled_by_pair_day(aws["s3"], "wsf-test-raw", [date(2026, 7, 30)])
    assert slots[("2026-07-30", 3, 7)] == {"06:10", "07:55"}


def test_snapshot_taken_after_the_service_day_is_ignored(aws):
    # A schedule fetched the next morning is not the plan riders saw.
    put_schedule(
        aws,
        [schedule_line("2026-07-31T18:00:00+00:00", [T0610, T0755])],
        dt="2026-07-31",
    )
    put_schedule(aws, [schedule_line("2026-07-30T16:00:00+00:00", [T0610])])
    slots = reconcile.scheduled_by_pair_day(aws["s3"], "wsf-test-raw", [date(2026, 7, 30)])
    assert slots[("2026-07-30", 3, 7)] == {"06:10"}


def test_missing_sailing_counts_as_not_sailed():
    scheduled = {("2026-07-30", 3, 7): {"06:10", "07:55"}}
    sailed = [{"service_date": "2026-07-30", "dep": 3, "arr": 7, "hhmm": "06:10"}]
    result = reconcile.reconcile(scheduled, sailed)
    assert result["totals"]["scheduled"] == 2
    assert result["totals"]["not_sailed"] == 1
    assert result["totals"]["rate_pct"] == 50.0
    assert result["pairs"][(3, 7)]["days"] == 1


def test_day_with_no_reported_sailings_is_unreconciled_not_all_cancelled():
    scheduled = {("2026-07-30", 3, 7): {"06:10", "07:55"}}
    result = reconcile.reconcile(scheduled, [])
    assert result["totals"]["unreconciled_days"] == 1
    assert result["totals"]["scheduled"] == 0  # never averaged in
    assert result["totals"]["rate_pct"] is None


def test_window_never_reaches_before_tracking_started():
    days = reconcile.window_days(date(2026, 8, 1))
    assert days[0] == reconcile.TRACKING_FLOOR
    assert days[-1] == date(2026, 8, 1)
    assert reconcile.window_days(date(2026, 7, 1)) == []
