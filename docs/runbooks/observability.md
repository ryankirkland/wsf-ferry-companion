# Observability: logs, cost, user activity

What exists in account 654654574183 today, how to read it, and - stated
plainly - what it cannot tell you. All commands assume:

```bash
eval "$(aws configure export-credentials --profile ryan --format env)"
export AWS_DEFAULT_REGION=us-west-2
```

Sessions expire after a while; re-run `aws login` when a command reports
expired credentials.

---

## 1. Application logs

Every Lambda writes to its own CloudWatch log group, **30-day retention**
on all thirteen `wsf-prod-*` groups (set in Terraform, so it survives a
redeploy).

| Group | What it tells you |
|---|---|
| `wsf-prod-ingest-vessels` | the 15 s fleet poller - the busiest log |
| `wsf-prod-ingest-schedule` | schedule refresh, token gating, horizon rolls |
| `wsf-prod-ingest-alerts` | alert watermark + change detection |
| `wsf-prod-ingest-dims` | dim republishes (and the `force-rebuild` lever) |
| `wsf-prod-notify-fanout` | alert matching and SES sends |
| `wsf-prod-notify-api` | subscription CRUD |
| `wsf-prod-notify-suppress` | bounces and complaints |
| `wsf-prod-analytics-sync` | nightly vesselhistory sweep + backfills |
| `wsf-prod-analytics-transform` | raw -> Parquet |
| `wsf-prod-analytics-stats` | the nightly stats publish |
| `wsf-prod-analytics-capacity` | the 1-minute capacity poller |
| `wsf-prod-tiles-fallback`, `wsf-prod-api-hello` | rarely interesting |

**Tail one live:**

```bash
aws logs tail /aws/lambda/wsf-prod-analytics-stats --follow --since 1h
```

**Find errors across everything in the last day** - the one command worth
memorising:

```bash
for g in $(aws logs describe-log-groups --log-group-name-prefix /aws/lambda/wsf-prod \
  --query 'logGroups[].logGroupName' --output text); do
  n=$(aws logs filter-log-events --log-group-name "$g" \
      --start-time $(( ($(date +%s) - 86400) * 1000 )) \
      --filter-pattern '?ERROR ?Traceback ?"Task timed out"' \
      --query 'length(events)' --output text)
  [ "$n" != "0" ] && echo "$g: $n"
done
```

**The structured lines.** Handlers print one JSON object per notable
event, so Logs Insights can read them as fields rather than text. Useful
starters:

```bash
# What did the nightly stats run actually publish?
aws logs filter-log-events --log-group-name /aws/lambda/wsf-prod-analytics-stats \
  --filter-pattern '"Stats"' --query 'events[-1].message' --output text

# Which vessels failed a history sweep, and why?
aws logs filter-log-events --log-group-name /aws/lambda/wsf-prod-analytics-sync \
  --filter-pattern '"HistoryFetchFailure"' --query 'events[].message' --output text
```

**Custom metrics** ride the same log lines via EMF (embedded metric
format), so a metric costs no extra API call. Four namespaces:
`WSF/Ingest`, `WSF/Notify`, `WSF/Analytics`, `WSF/Weather`. The ones
worth knowing:

| Metric | Namespace | Means |
|---|---|---|
| `PollSuccess` | WSF/Ingest | fleet polls that worked (~5,760/day at 15 s) |
| `DimsTokenChurn` | WSF/Ingest | upstream flushed its cacheflushdate but the served dim content was identical - absorbed, nothing published or invalidated. Expect ~96/day (terminals churns constantly); a sustained 0 with DimsRefreshed also 0 means the token gate stopped seeing changes at all |
| `PairDatesUnchanged` / `FaresUnchanged` | WSF/Ingest | schedule/fares token moved but the rebuilt files were byte-identical (minus volatile fields) - absorbed by the content gate, no S3 PUTs. Expect ~530/run of PairDatesUnchanged on churn runs. `PairDatesPublished` still fires at least daily via the horizon roll, which is what keeps the pairs-stale alarm fed |
| `AuthFailure` | WSF/Ingest | the 400+Message signature - the API-key canary |
| `EmptyFleet` | WSF/Ingest | upstream returned `[]` |
| `DeliveriesQueued` / `EmailsSent` | WSF/Notify | matched users handed to SQS / messages accepted by SES |
| `AlertEmailLatency` | WSF/Notify | current bulletin text observation -> SES acceptance |
| `DeliveryDuplicates` / `DeliverySuppressed` / `DeliveryUnsubscribed` / `BulletinCapped` / `DailyCapped` | WSF/Notify | queue duplicates, hygiene skips, and intentional send limits |
| `ParseMisses` | WSF/Notify | prose the parser could not decode |
| `StatsPublished` / `StatsDataLagDays` | WSF/Analytics | the F4 freshness SLO |
| `UnmappedSlip` | WSF/Analytics | vocabulary drift, sailings in quarantine |
| `CapacityTerminalsReporting` | WSF/Analytics | how many terminals report space |
| `EventsCollected` | WSF/Analytics | beacon events accepted by the collector. Watched by `wsf-prod-analytics-events-collection-silent` (all 24 hourly buckets empty -> alarm): the beacon path is fire-and-forget end to end, so a broken CloudFront hop collects zero events and nothing else says so - which is exactly what happened 2026-08-03 to 2026-08-15 |

```bash
aws cloudwatch get-metric-statistics --namespace WSF/Ingest --metric-name PollSuccess \
  --start-time "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Sum --query 'Datapoints[0].Sum' --output text
```

**You should not need to watch any of this.** 23 alarms cover the failure
modes and email the `wsf-prod-alarms` SNS topic; the logs are for
answering *why* after an alarm says *that*. Current state:

```bash
aws cloudwatch describe-alarms --state-value ALARM \
  --query 'MetricAlarms[].AlarmName' --output text   # empty is good
```

### Known gap: six legacy log groups never expire

`rainforest-extractor-dev-*`, `rainforest-transformer-dev-*`,
`sp-reports-processor`, `/aws/rds/instance/rainforest-db/postgresql`
(3.9 MB) and `/aws/rds/proxy/rainforest-proxy` predate this project and
have **no retention policy**, so they grow forever. Pennies today, but
they are the only unbounded storage in the account. Deleting them is a
one-liner per group when you want it done.

---

## 2. Cost

**Two budgets exist**, which is why the alert you got did not match the
project's ceiling:

| Budget | Limit | Whose |
|---|---|---|
| `My Monthly Cost Budget` | $20 | pre-existing, account-wide - **this is the one that emailed you** |
| `wsf-monthly-ceiling` | $15 | this project's, created in the bootstrap stack |

Worth deciding whether to keep both. Two budgets watching one account
means alerts fire against whichever threshold trips first, which is what
made the $20.08 email look like a project overrun when it was not.

**July 2026 actual: $20.51**, and it decomposes cleanly:

| Line | Amount | Note |
|---|---|---|
| Amazon Registrar | **$16.00** | ferrysound.com, **one-time**, recurs July 2027 |
| Tax | $1.49 | on the above |
| S3 | $0.81 | raw archive + Parquet + serving |
| EC2-Other | $0.60 | legacy EBS, now terminated |
| Route 53 | $0.50 | hosted zone, fixed monthly |
| Secrets Manager | $0.38 | legacy `sp_api` secret, deletion scheduled |
| DynamoDB | $0.35 | |
| RDS | $0.30 | legacy, gone |
| Cost Explorer | $0.07 | the API calls behind these very commands |
| Athena | $0.01 | the whole nightly stats suite |

So **85% of the bill was the domain**, and roughly $1.28 more was legacy
cruft that is now cleaned up (the last three days show EC2-Other at
$0.006 and RDS at zero).

**The real run-rate**, which is what to watch:

```bash
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=$(date -u -v-14d +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY --metrics UnblendedCost \
  --query 'ResultsByTime[].[TimePeriod.Start,Total.UnblendedCost.Amount]' --output text
```

Baseline before M4 was **$0.04/day**. The 07-30 and 07-31 spikes ($1.03,
$0.53) were the 24-year backfill, ten full transform runs and repeated
Athena suites - one-time build cost, not run-rate.

**Expect August around $2.50-3.00** was this section's original estimate,
and August proved it wrong - actuals through Aug 14 ran ~$0.47/day, then
~$0.90/day, forecasting ~$21 for the month. Three findings (2026-08-15):

1. **CloudFront invalidations, ~$0.50/day from Aug 11.** The dims
   refresher trusted the terminals cacheflushdate token, which WSDOT
   flips on essentially every poll, so it republished and invalidated
   `/data/terminals.json` 96x/day since launch (~Jul 28). July hid it
   inside the 1,000 free invalidation paths; August burned through them
   on the 10th. Fixed by the content-hash gate in `dims.py` (see
   `DimsTokenChurn` above): invalidations now happen only on real
   content changes. Expected steady state: ~0.
2. **S3 Tier-1 requests, ~$0.33/day** (~66k PUT-class requests/day from
   the pollers) - roughly 23x this section's "$0.43/mo" estimate.
   Structural; candidate fix is batching raw archive writes.
3. **DynamoDB writes** were ~$0.145/day (~21 vessels x 5,760 polls) and were
   described here as "the realtime map's design cost, not a defect". That was
   wrong: the map never read them. The FLEET#/VESSEL# partition was retired
   on 2026-08-24 (ADR-0005, amended) after an audit found no production
   reader. Expect the DynamoDB line to fall by ~99%. **Also protect the raw
   archive from blanket expiry**: raw/vessellocations/ and
   raw/terminalsailingspace/ are the only position and capacity history that
   exists - upstream cannot serve past values - and they are the substrate
   for future wait-time modelling.

The original line items stand: $0.50 hosted zone, ~$0.04 Athena, and
**~$1.00 of CloudWatch alarms** - 20 alarms, 10 past the free tier at
$0.10 each (August is the first month that bills them).

**Alarm cost is not the reason to delete an alarm.** At a dime each,
the question is always signal, never spend. An earlier version of this
section flagged `stats-data-lag` and `analytics-empty-night` as
"trimmable, partly covered by `stats-not-fresh`" - re-reading their
definitions on 2026-08-22 says otherwise, and they stay. `stats-not-fresh`
only asks "did we publish"; the other two catch the cases where
publishing SUCCEEDS on rotten evidence (transform behind by >2 days;
every vessel returning zero history rows). Those are silent-failure
detectors of exactly the class this project fears most, and neither has
ever fired falsely. What DOES justify surgery is noise: see
`weather-degraded` below.

**By service, this month:**

```bash
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=$(date -u +%Y-%m-01),End=$(date -u -v+1d +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' --output text
```

---

## 3. User activity

**Updated 2026-08-03: this used to be the honest "almost none, by
construction" section. It no longer is** - see
`docs/features/site-analytics.md` and ADR-0007 for the full pipeline.
CloudFront **access logging is still disabled** (unchanged - that
decision stands on its own merits, see below), but a first-party beacon
now records page views, clicks, referrers, and coarse geography, rolled
up nightly into a Cognito-gated `/admin/analytics` dashboard.
`/account`'s "No tracking" line is gone; the replacement copy states
plainly what is collected and offers an opt-out.

**Where to look**: `/admin/analytics` (signed in as the account added to
the Cognito `Admins` group - see `docs/features/site-analytics.md` for
the one-time setup step) for visit trend, top pages, top-clicked
elements, referrers, geography, and unique/returning visitor counts. The
raw event stream lives at `raw/site_events/dt=<date>/*.json` in the raw
bucket if you ever need to query it directly with Athena
(`wsf_prod_analytics.site_events`); the nightly rollup Lambda is
`wsf-prod-analytics-events-stats` (04:10 PT), and its private summary
JSON lives under `analytics/site_events_daily/` and
`analytics/site_events_monthly/` in the same bucket - deliberately NOT
in the public data bucket, since this is the one dataset in the project
that must stay behind auth.

**Why CloudFront access logging is still off**: nothing about building
first-party analytics changed the tradeoff that made it off in the
first place (raw-IP retention, S3 storage/lifecycle for a dataset
nobody queries). The beacon pipeline gets what was actually wanted
(clicks, which server logs can't see at all) while hashing and
discarding the IP at ingestion instead of storing it - a stricter
privacy posture than turning CloudFront logging on would have been.

### What you can see today

**Aggregate CloudFront metrics** (free, no logging required, ~5 min
delay). Request volume is a real usage signal even without identities:

```bash
DIST=E1ZEOCBXLOJE3Z
aws cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/CloudFront \
  --metric-name Requests --dimensions Name=DistributionId,Value=$DIST Name=Region,Value=Global \
  --start-time "$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Sum \
  --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Sum]' --output text
```

Recent: 1,168 requests on 07-28, 3,428 on 07-29, 10,599 on 07-30 - though
much of that is me testing, and an ambient tab polling `/data/fleet.json`
every 12 s generates ~7,200 requests/day on its own. **Request counts are
not people.** Other useful metrics on the same dimension:
`BytesDownloaded`, `4xxErrorRate`, `5xxErrorRate`, `CacheHitRate`.

**Accounts and subscriptions** are countable because they are ours:

```bash
aws cognito-idp describe-user-pool --user-pool-id us-west-2_Rvw5RQOP0 \
  --query 'UserPool.EstimatedNumberOfUsers' --output text          # currently 1 (you)

aws dynamodb scan --table-name wsf-prod-hot \
  --filter-expression "begins_with(SK, :s)" \
  --expression-attribute-values '{":s":{"S":"SUB#"}}' \
  --select COUNT --query 'Count' --output text                      # currently 2
```

**Delivery health** stands in for engagement on the alerts side:
`DeliveriesQueued`, `EmailsSent`, `AlertEmailLatency`, the delivery
queue's oldest-message and DLQ alarms, and the SES bounce/complaint path
via `wsf-prod-notify-suppress`. A DLQ message contains the complete
matched-delivery contract and remains available for 14 days; inspect the
delivery Lambda error first, then use SQS DLQ redrive to return it to the
source queue after fixing the cause.

### Historical note: the options this runbook used to weigh

As of 2026-08-01 this section listed three options - CloudFront logs,
a privacy-preserving counter, or leaving it alone - and recommended
CloudFront logs with a copy change. Ryan instead asked for click
tracking (which CloudFront logs can't provide at all) plus geography
and a dashboard, so what got built (`docs/features/site-analytics.md`,
ADR-0007) is closer in spirit to option 2 but considerably more capable
- a first-party beacon rather than raw request logs, with the IP hashed
and discarded at ingestion rather than ever stored. Kept here as
context for why the pipeline looks the way it does, not as an open
question anymore.

---

## History

- 2026-08-01: written after the July budget alert, with the two-budget
  discrepancy and the disabled access logging both surfaced as findings.
- 2026-08-03: section 3 rewritten - homegrown site analytics shipped
  (`docs/features/site-analytics.md`, ADR-0007), so "almost no user
  activity is measurable" is no longer true.
