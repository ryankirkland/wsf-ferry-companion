# ADR-0007: Homegrown site analytics

- **Status:** Accepted (2026-08-03)
- **Context:** Ryan asked for page-visit, click, referrer, and coarse-geo
  analytics without adopting a third-party tool (task #21). The
  observability runbook (2026-08-01) had already surfaced that CloudFront
  access logging is off *by design* to keep `/account`'s "No tracking, no
  newsletters - just your boats" literally true, and recommended either
  turning on CloudFront logs with a copy change, or a from-scratch
  privacy-preserving counter. Ryan's answers across the PRD thread picked
  neither exactly: he wants clicks (which CloudFront logs can't see at
  all - they're server-side request logs), a monthly-rotating identity
  for returning-visitor counts, and a dashboard, all while keeping the
  "not for advertising" framing explicit to visitors. This ADR records
  the shape actually built and the four departures from the F4 pipeline
  it otherwise mirrors.

## Decisions

**A first-party beacon, not CloudFront logs.** CloudFront's own access
logs (the runbook's option 1) only see requests that hit an origin - they
cannot see in-page clicks, and enabling them would log raw IPs by
default. A small `POST /v1/events` collector Lambda, called from a
client-side beacon on every page load and on clicks tagged with
`data-analytics-label`, covers both signals and lets the server derive
only what it's told to keep (never a raw IP - see below).

**Geography via CloudFront-forwarded headers, not third-party GeoIP.**
`/v1/events` is fronted by the site's own CloudFront distribution (a new
`ordered_cache_behavior` proxying to the API Gateway origin) instead of
being called directly against `api.<domain>` the way `/v1/subscriptions`
is. CloudFront resolves `CloudFront-Viewer-Country/-Region/-City` at the
edge for free and forwards them to the Lambda via the managed
`AllViewerAndCloudFrontHeaders-2022-06` origin request policy - avoiding
a MaxMind/third-party lookup entirely, which would mean sending visitor
IPs off our own infrastructure. The route is `CachingDisabled` (it's a
POST with a distinct visitor hash + geo per request, never cacheable).

**Visitor identity: SHA-256(month + real client IP + User-Agent), IP
never persisted.** Because the collector sits behind CloudFront, the
Lambda's own `sourceIp` is CloudFront's edge IP, not the visitor's - the
real IP is the first hop of `X-Forwarded-For`, which CloudFront always
sets. That IP is hashed with the User-Agent and the current Pacific
month and immediately discarded; only the 16-hex-char hash is written to
S3. A visitor returning within the same month collapses to one
"returning visitor"; nothing links one month's hash to the next
(Ryan's explicit call in the PRD thread - "a once a month rotating hash
is just fine... if people are coming back more than once in the same
month, that's a pretty cool signal").

**No Parquet transform stage - Athena reads the raw JSON directly.**
F4's history pipeline (ADR-0001) transforms raw NDJSON into
year-partitioned Parquet before Athena ever touches it, because vessel
history is a multi-decade, multi-million-row table where query cost and
scan time matter. Site-events volume for a single-operator portfolio
site never approaches that scale, so a Glue external table with a JSON
SerDe and daily partition projection reads `raw/site_events/dt=.../*`
directly - one fewer Lambda, one fewer point of failure, for a dataset
where Parquet's benefits don't materialize. If traffic ever grows enough
to matter, this is a targeted follow-up, not a redesign.

**Private daily + monthly summaries, not a public `/data/*.json`
contract - and no live Athena at request time.** Every other stats
contract in this project (`/data/stats/*.json`) is intentionally public,
served straight off CloudFront - that's wrong for analytics, whose whole
point is Cognito-gating to Ryan alone. A nightly Lambda
(`wsf-prod-analytics-events-stats`) writes `analytics/site_events_daily/
dt=<date>.json` and `analytics/site_events_monthly/month=<month>.json`
into the **raw bucket** (already private, `block_public_acls` on,
never CloudFront-served) rather than the public data bucket. The
`/admin/analytics` read Lambda serves only from those precomputed files
- consistent with ADR-0005's "nobody waits on Athena at request time,"
just enforced here for a different reason (this consumer is a single
admin loading a dashboard occasionally, not the public at request
volume, but the precomputed-JSON discipline is worth keeping anyway:
it bounds cost and avoids inventing a second query-time code path).
Arbitrary date-range selection in the dashboard works by summing the
requested days' precomputed files in the read Lambda, not by re-querying
Athena live.

**Cognito group gate, checked server-side, not just page-side.** Every
existing Cognito-authenticated route in this app (`/alerts`,
`/v1/subscriptions`) gates on "signed in," not "who." A new `Admins`
Cognito user group is the first role distinction in the app. The
`/v1/admin/analytics` Lambda checks `cognito:groups` in the validated
JWT claims and 403s before touching S3 if `"Admins"` is absent - the
frontend page also gates on `useAuth()`, but the enforcement that
matters is server-side, since the same origin serves the page bundle to
anyone. Terraform creates the empty group; adding Ryan's account to it
is a one-time manual `aws cognito-idp admin-add-user-to-group` step
after he first signs up (documented in
`docs/features/site-analytics.md`), since his user doesn't exist at
`terraform plan` time.

**Default-on tracking with a visible opt-out, not a blocking consent
gate.** Ryan's explicit framing: "exempt people from tracking if they
don't want to be tracked," with the banner stating plainly this isn't
for advertising. A dismissible banner shown once (localStorage flag,
not a tracking identifier) offers "Opt out," which sets a second
localStorage flag the beacon checks before sending anything. This is a
reasonable posture for a small WA-focused ferry site and is explicitly
NOT verified GDPR-compliant for EU visitors - accepted as-is per Ryan,
revisit if international traffic or legal exposure grows (carried over
verbatim from the PRD's open risks).

## Consequences

- `/account`'s "No tracking, no newsletters - just your boats" line is
  gone, replaced with copy naming both facts: alerts-only accounts (no
  newsletters, still true) and anonymous, non-advertising, opt-outable
  analytics (new, and now true).
- The raw bucket gains two new private prefixes
  (`analytics/site_events_daily/`, `analytics/site_events_monthly/`) and
  one new public-facing prefix under the SAME bucket
  (`raw/site_events/`) - all covered by the bucket's existing
  `block_public_acls`/`restrict_public_buckets` settings, so no new
  bucket or ACL surface was needed.
- Cost: one more low-traffic Lambda behind API Gateway (collector, ~128
  MB/10 s, called once per pageview/click - throttled to 20 rps/40
  burst), one small nightly Lambda (~256 MB/300 s), one small
  authenticated read Lambda, one new CloudFront cache behavior (no
  additional distribution), one new CloudWatch alarm
  (`events-stats-errors`, matching the `transform_errors`/`stats_errors`
  pattern). All well inside the existing <$15/mo ceiling at this
  traffic scale; no new fixed-cost service.
- Bot/crawler noise and ambient-tab polling inflating raw counts (both
  flagged as open risks in the PRD) are not filtered in v1 - the
  dashboard labels `/ambient` page views separately so wall-tablet
  sessions don't silently blend into "real visitor" numbers, but
  general bot filtering is a documented follow-up, not built here.
