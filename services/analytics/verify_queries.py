"""Run the whole nightly query suite against real Athena.

The unit tests assert the SQL's structure; only a Trino engine can say
whether it parses and returns rows. That check belongs to deploy, not CI:
it needs credentials and it costs (a fraction of a cent) per run.

    eval "$(aws configure export-credentials --profile ryan --format env)"
    AWS_DEFAULT_REGION=us-west-2 uv run python services/analytics/verify_queries.py

Exits non-zero if any query fails, so it can gate a release.
"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

import boto3
from wsf_analytics import events_stats, queries
from wsf_analytics.athena import Athena, AthenaError


def main() -> int:
    athena = Athena(
        "wsf_prod_analytics",
        "wsf-prod-analytics",
        client=boto3.client("athena"),
    )
    # Any recent cutoff exercises the same code path the nightly run takes.
    cutoff = (date.today() - timedelta(days=queries.PRIMARY_WINDOW_DAYS)).isoformat()
    since = (date.today() - timedelta(days=14)).isoformat()

    # site_events queries (F6 site-analytics, events_stats.py) - a separate
    # Glue table from the history queries above, with its own partition
    # column (dt, string-typed) - a mismatched literal type here (the
    # 2026-08-08 incident) is invisible to the mocked unit tests, so it must
    # be exercised against real Athena same as the history queries.
    day = (date.today() - timedelta(days=1)).isoformat()
    month_start = date.today().replace(day=1).isoformat()
    today = date.today().isoformat()

    suite = [
        ("bounds", queries.data_bounds()),
        ("slots", queries.slots(cutoff)),
        ("hours", queries.hours(cutoff)),
        ("pairs", queries.pairs(cutoff)),
        ("seasons", queries.seasons()),
        ("system", queries.system(cutoff)),
        ("vessels", queries.vessels(cutoff)),
        ("months", queries.months()),
        ("recent_days", queries.recent_days(since)),
        ("sailed_slots", queries.sailed_slots(since)),
        ("events_totals", events_stats._totals(day)),
        ("events_by_path", events_stats._by_path(day)),
        ("events_by_click_label", events_stats._by_click_label(day)),
        ("events_by_referrer", events_stats._by_referrer(day)),
        ("events_by_geo", events_stats._by_geo(day)),
        ("events_monthly_totals", events_stats._monthly_totals(month_start, today)),
        ("events_returning_visitors", events_stats._returning_visitors(month_start, today)),
    ]

    failures = []
    for name, sql in suite:
        try:
            rows = athena.query(sql)
        except AthenaError as exc:
            failures.append((name, str(exc)))
            print(f"  {name:13} FAILED  {exc}")
            continue
        print(f"  {name:13} {len(rows):6} rows")

    scanned_mb = athena.bytes_scanned / 1e6
    print(f"\nscanned {scanned_mb:.0f} MB  (about ${athena.bytes_scanned / 1e12 * 5:.4f})")
    if failures:
        print(f"\n{len(failures)} QUERY FAILURE(S) - do not deploy")
        return 1
    print(f"all {len(suite)} queries returned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
