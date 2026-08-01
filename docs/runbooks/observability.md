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
format), so a metric costs no extra API call. Three namespaces:
`WSF/Ingest`, `WSF/Notify`, `WSF/Analytics`. The ones worth knowing:

| Metric | Namespace | Means |
|---|---|---|
| `PollSuccess` | WSF/Ingest | fleet polls that worked (~5,760/day at 15 s) |
| `AuthFailure` | WSF/Ingest | the 400+Message signature - the API-key canary |
| `EmptyFleet` | WSF/Ingest | upstream returned `[]` |
| `AlertEmailLatency` | WSF/Notify | bulletin first-seen -> inbox |
| `ParseMisses` | WSF/Notify | prose the parser could not decode |
| `StatsPublished` / `StatsDataLagDays` | WSF/Analytics | the F4 freshness SLO |
| `UnmappedSlip` | WSF/Analytics | vocabulary drift, sailings in quarantine |
| `CapacityTerminalsReporting` | WSF/Analytics | how many terminals report space |

```bash
aws cloudwatch get-metric-statistics --namespace WSF/Ingest --metric-name PollSuccess \
  --start-time "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Sum --query 'Datapoints[0].Sum' --output text
```

**You should not need to watch any of this.** 16 alarms cover the failure
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

**Expect August around $2.50-3.00**, made of the $0.50 hosted zone, the
~$1.20 baseline, and M4's additions: ~$0.43 S3 PUTs from the 1-minute
capacity poller, ~$0.04 Athena, and **~$0.60 of CloudWatch alarms** -
six past the 10-alarm free tier. Alarms were created 2026-07-31, so
August is the first month that bills them; if that $0.60 annoys you, the
trimmable ones are `stats-data-lag` and `analytics-empty-night`, both
partly covered by `stats-not-fresh`.

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

**This is the honest one: there is almost none, by construction.**

CloudFront **access logging is disabled**, so there is no per-request
record anywhere. No page views, no unique visitors, no geography, no
"which pair pages do people actually open". That is not an oversight to
quietly fix - `/account` currently tells users *"No tracking, no
newsletters - just your boats."* Turning on behavioural analytics would
make that copy false.

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
`AlertEmailLatency` and the SES bounce/complaint path via
`wsf-prod-notify-suppress`.

### If you want more, three honest options

1. **CloudFront standard logs to S3** (~free; you pay S3 storage). Gives
   per-request path, status, cache hit, coarse geography, referrer - then
   query with Athena, which this project already runs. This is
   *server-side request logging*, not cross-site tracking, but it does
   record IP addresses, so the `/account` copy should be revised to say
   what is kept and for how long, and a lifecycle rule should expire it.
2. **A privacy-preserving counter** - a tiny endpoint recording page
   *paths* with no identifiers at all, keeping the "no tracking" promise
   literally true. More work, weaker data.
3. **Leave it.** For a portfolio project whose thesis is honesty, "we do
   not measure our users" is a defensible position, and CloudFront's
   aggregate metrics already tell you whether anyone is out there.

My recommendation is (1) **with the copy updated in the same change** -
never one without the other.

---

## History

- 2026-08-01: written after the July budget alert, with the two-budget
  discrepancy and the disabled access logging both surfaced as findings.
