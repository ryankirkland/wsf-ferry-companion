# Homegrown site analytics

## Goal

Give Ryan visibility into how the site is actually used - page visits, what gets clicked,
where traffic comes from, roughly where visitors are, and whether people come back - without
adopting Google Analytics or any third-party tracker. See ADR-0007 for the full architectural
reasoning and the departures from the F4 stats pipeline this otherwise mirrors.

## Target user

Ryan, and only Ryan. This is the first feature in the app with an internal, single-operator
audience rather than a rider-facing one. Every design choice - default-on tracking with a
visible opt-out, coarse non-advertising geo, monthly-rotating visitor identity, a
Cognito-group-gated dashboard - was scoped in a PRD conversation where he was explicit that
this is for catching bugs and understanding traffic, not for advertising or user profiling.

## Dependencies

- The existing Cognito user pool (`infra/modules/notify/cognito.tf`) - reused for the
  `/admin/analytics` gate via a new `Admins` user group. **Manual step after first deploy**:
  Ryan must sign up through `/account` once, then be added to the group -
  `aws cognito-idp admin-add-user-to-group --user-pool-id <pool id> --username <his email> --group-name Admins`.
  Terraform creates the group but cannot add a user that doesn't exist yet at `terraform plan`
  time.
- The existing raw S3 bucket, Glue database (`wsf_prod_analytics`), and Athena workgroup
  (`wsf-prod-analytics`) from the F4 pipeline - this feature adds a new Glue table and two new
  private prefixes rather than new infrastructure.
- The shared HTTP API (`infra/modules/api`) and the main CloudFront distribution
  (`infra/modules/static-site`), which gained a new origin + cache behavior so `/v1/events`
  resolves visitor geography at the edge.

## How it works

```
beacon (client JS, every page load + tagged clicks)
  -> POST /v1/events                                     [via CloudFront, geo headers attached]
  -> raw/site_events/dt=<pacific date>/<request-id>.json  [events Lambda]
  -> Athena (Glue table, daily partition projection)      [events-stats Lambda, nightly 04:10 PT]
  -> analytics/site_events_daily/dt=<date>.json           (private - raw bucket, not CloudFront-served)
  -> analytics/site_events_monthly/month=<month>.json     (private - recomputed nightly, current month)
  -> GET /v1/admin/analytics?from=&to=                    [events-admin Lambda, Cognito+Admins-group gated]
  -> /admin/analytics dashboard                            [Next.js, Cognito-gated]
```

**What's collected, per event**: `path` (query string stripped), `referrer` reduced to
hostname only (`"reddit.com"`, `"direct"` - never the full referring URL), `label` for clicks
(from a `data-analytics-label` attribute on nav links, the alerts subscribe CTA, trip search
submit, and the ambient toggle), `ambient` (true on `/ambient` routes, so wall-tablet sessions
can be shown separately rather than blended into visitor engagement numbers), coarse
`country`/`region`/`city` from CloudFront's edge resolution, and a `visitor_hash`.

**What's never collected**: the raw IP address (hashed and discarded inside the collector
Lambda, never written to S3 or logged), precise GPS, referrer query strings/paths, any link to
a signed-in Cognito identity (tracking is anonymous even for logged-in alert subscribers - see
ADR-0007), and no client-supplied timestamp is trusted (event dates come from the Lambda's own
clock).

**Visitor identity**: `SHA-256(pacific-month + real client IP + User-Agent)`, truncated to 16
hex characters, rotated monthly. Distinguishes unique vs. returning visitors *within* a
calendar month; nothing links one month's hash to the next.

## The honesty rules

Same convention as the F4 stats pipeline (`docs/features/stats.md`) - every number the
dashboard shows says what it does and doesn't cover, rather than implying more precision than
the method supports.

- **Unique/returning visitor counts are always labeled by month**, never presented as if they
  cover an arbitrary selected date range - they're computed monthly by construction (see
  ADR-0007), and the dashboard shows `days_covered` alongside them so a partial month reads as
  partial, not as a full month's number. `days_covered` counts any day with event data at all,
  ambient included - it answers "how far has this aggregation progressed," not "how many days
  had real visitors," so the ambient exclusion below is scoped (via a `FILTER`) to
  `unique_visitors` only and never touches `days_covered`.
- **The just-closed month's `days_covered` is only trustworthy after the 1st of the next
  month.** A month's last rolling write happens the night of its own final day and only covers
  midnight-to-run-time for that day - the same partial-day gap the daily rollup avoids by
  always waiting for "yesterday" to fully elapse. On the 1st of the next month, one extra
  finalizing query overwrites that month's file with its true, fully-elapsed totals; every
  write before that is an intentionally partial, in-progress snapshot (the "stays fresh as the
  month progresses" tradeoff).
- **A day or month with no summary file yet is shown as "no data," never as a silent zero** -
  the admin API returns `missing_days`/`missing_months` explicitly rather than letting an
  absent file collapse into an empty count.
- **Ambient (`/ambient`) page views are counted and shown separately** from other traffic in
  the visit-trend chart, and are excluded entirely from unique/returning visitor counts
  (`NOT ambient` in both queries) - a wall tablet polling for hours would otherwise dominate
  the pageview total and, left in the visitor-identity queries, would be guaranteed to look
  like a returning visitor every month it stayed plugged in.
- **Geography is labeled approximate.** IP-derived coarse geo (via CloudFront's edge
  resolution, no third-party GeoIP call) can misplace VPN, mobile-carrier-NAT, or data-center
  traffic - the dashboard says so rather than presenting country/region/city as authoritative.
- **Hash-based uniqueness is an approximation, not an identity.** Shared IPs (a household, a
  coffee shop) collapse to one visitor; this is accepted and stated, the same way the F4
  pipeline states a window and an n rather than claiming precision it doesn't have.
- **Bot/crawler traffic and the ambient tab's own polling are not filtered in v1** - a
  documented follow-up (see ADR-0007's consequences), not silently corrected for in the
  numbers shown today.

## Operational notes

- **`dt` is a string partition column, not a DATE one.** The `site_events`
  Glue table (`infra/modules/analytics/glue.tf`) declares `dt` as
  `type = "string"` even though partition projection formats it as
  `yyyy-MM-dd` - Athena/Trino exposes the column to SQL as varchar. Every
  query in `events_stats.py` compares it against a plain string literal
  (`dt = '2026-08-01'`), never a `DATE '...'` literal - `varchar = date` is
  a `TYPE_MISMATCH` that Athena rejects outright. This shipped broken on
  2026-08-03 and failed every nightly run until fixed on 2026-08-08 (task
  #57): the unit tests mock Athena entirely and can't catch a real SQL
  type error, so `services/analytics/verify_queries.py` (the pre-deploy
  real-Athena check) now also runs the full `events_stats.py` query suite,
  not just the F4 history queries - see that file's docstring for how to
  run it.

## Consent and copy

A dismissible banner appears once per browser (localStorage flag, not itself a tracking
identifier) stating plainly that this is anonymous usage tracking for reliability and traffic
understanding, explicitly **not for advertising**, with a working "Opt out" that sets a second
localStorage flag the beacon checks before sending anything - default is opted-in/tracked,
matching Ryan's "exempt people who don't want it" framing rather than a blocking consent gate.
`/account`'s stale "No tracking, no newsletters - just your boats" line was removed and
replaced with copy naming both facts: alerts-only accounts (still true, no newsletters) and
anonymous, non-advertising, opt-outable analytics (new).

## Update this file

Whenever the collected-fields list, the retention/aggregation shape, the consent copy, or the
admin-gating mechanism changes.
