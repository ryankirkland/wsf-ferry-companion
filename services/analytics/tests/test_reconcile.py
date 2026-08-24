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


def test_multi_stop_journey_is_not_a_cancellation():
    # The schedule sells Fauntleroy -> Southworth; the boat physically runs
    # Fauntleroy -> Vashon -> Southworth and the feed logs the first leg.
    # Matching whole pairs called this a cancellation (80% on this route);
    # matching the departure dock and minute sees the sailing that left.
    scheduled = {("2026-07-30", 9, 20): {"08:30"}, ("2026-07-30", 9, 22): {"08:30"}}
    sailed = [{"service_date": "2026-07-30", "dep": 9, "arr": 22, "hhmm": "08:30"}]
    result = reconcile.reconcile(scheduled, sailed)
    assert result["totals"]["not_sailed"] == 0
    assert result["pairs"][(9, 20)]["not_sailed"] == 0


def test_terminal_with_no_reported_departures_is_unreconciled():
    scheduled = {("2026-07-30", 3, 7): {"06:10", "07:55"}}
    result = reconcile.reconcile(scheduled, [])
    assert result["totals"]["unreconciled_days"] == 1
    assert result["totals"]["scheduled"] == 0  # never averaged in
    assert result["totals"]["rate_pct"] is None


def test_window_excludes_the_partially_collected_last_day():
    # data_through is the day collection stopped mid-afternoon; counting
    # its un-fetched evening as cancelled turned a normal day into 37%.
    days = reconcile.window_days(date(2026, 8, 5))
    assert days[-1] == date(2026, 8, 4)


def test_window_never_reaches_before_tracking_started():
    days = reconcile.window_days(date(2026, 8, 1))
    assert days[0] == reconcile.TRACKING_FLOOR
    assert days[-1] == date(2026, 7, 31)
    # Only the tracking floor itself is in the history: nothing complete yet.
    assert reconcile.window_days(date(2026, 7, 29)) == []


def test_reads_only_the_newest_snapshots_per_day(aws):
    """The 2026-08-20 outage: this read EVERY object in the window, grew
    ~36 s per day of window, and hit the 600 s ceiling with no way back
    (a full 30-day window computed to ~975 s against Lambda's 900 s
    maximum). The answer only ever depends on the last snapshot a rider
    could have seen, so the read must stay bounded as history grows."""
    # 40 snapshots across the service day, oldest first, each adding a
    # sailing so the newest is distinguishable.
    for i in range(40):
        put_schedule(
            aws,
            [schedule_line(f"2026-07-30T{i // 2:02d}:00:00+00:00", [T0610])],
            name=f"{i:02d}00.ndjson.gz" if i < 24 else f"23{i:02d}.ndjson.gz",
        )
    # The winner: newest key, and the only one carrying the 07:55 sailing.
    put_schedule(
        aws,
        [schedule_line("2026-07-30T23:50:00+00:00", [T0610, T0755])],
        name="2359.ndjson.gz",
    )

    gets = {"n": 0}
    real_get = aws["s3"].get_object

    def counting_get(**kwargs):
        gets["n"] += 1
        return real_get(**kwargs)

    aws["s3"].get_object = counting_get
    slots = reconcile.scheduled_by_pair_day(aws["s3"], "wsf-test-raw", [date(2026, 7, 30)])

    assert slots[("2026-07-30", 3, 7)] == {"06:10", "07:55"}, "newest snapshot must still win"
    assert gets["n"] <= reconcile.SNAPSHOTS_PER_DAY, (
        f"read {gets['n']} objects for one service day - the read must stay bounded"
    )


def test_key_time_filters_candidates_without_a_fetch(aws):
    # A snapshot flushed after the day's deadline is excluded by its KEY,
    # so it never costs a GET at all.
    put_schedule(aws, [schedule_line("2026-07-30T16:00:00+00:00", [T0610])], name="2300.ndjson.gz")
    put_schedule(
        aws,
        [schedule_line("2026-07-31T20:00:00+00:00", [T0610, T0755])],
        dt="2026-07-31",
        name="2000.ndjson.gz",  # 20:00 UTC on the 31st: past the deadline
    )
    gets = {"n": 0}
    real_get = aws["s3"].get_object

    def counting_get(**kwargs):
        gets["n"] += 1
        return real_get(**kwargs)

    aws["s3"].get_object = counting_get
    slots = reconcile.scheduled_by_pair_day(aws["s3"], "wsf-test-raw", [date(2026, 7, 30)])

    assert slots[("2026-07-30", 3, 7)] == {"06:10"}
    assert gets["n"] == 1, "the out-of-window object should never be fetched"
