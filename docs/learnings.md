# Learnings

What this implementation taught us, recorded so the lessons outlive the
incidents. Each entry: what actually happened (with the commit or PR
that fixed it), then the transferable rule. Newest lessons get added at
the bottom of their theme; this file is expected to grow.

## 1. Diagnosis discipline

**The TLS false flag (Aug 19-20, #107, `runbooks/incident-2026-08-19-wsdot-tls.md`).**
An 11.5 h WSDOT outage was misdiagnosed overnight as cloud-IP blocking.
The evidence fit: Lambda connections reset, residential requests fine,
access key valid. The actual cause was WSDOT's maintenance deploying a
certificate chain missing its intermediate - browsers repair that
silently (Authority Information Access chasing, intermediate caches);
strict clients correctly refuse. Three compounding mistakes:
- *Theory formed on mid-event evidence.* During the maintenance the
  failures genuinely were connection resets. The failure mode changed
  when their maintenance settled; the theory did not get re-tested.
- *Every confirming probe was incapable of falsifying.* All residential
  probes used chain-repairing clients (curl, browsers, phones). The one
  probe that kills the IP theory in a minute - a strict root-only
  client run FROM residential - was not run until a day in.
- *The first log group checked had no reason string* (see theme 3).

Rules: re-run probes after the event settles before acting on a theory
formed during it. Ask of every confirming test: could this instrument
even produce a disconfirming result? For any "works from vantage A,
fails from vantage B" split, suspect client-stack differences (TLS
chain building above all) before network filtering - `openssl s_client`
plus a strict-trust probe from the same machine discriminates in one
minute.

**Five days of alarms, three unrelated causes (#77).** One stream of
alarm email decomposed into: an Athena type error (`varchar = date`)
that had failed EVERY nightly run since launch because the moto tests
mock Athena and only production ever executed the SQL; a CloudFront
behavior forwarding the viewer Host header to an API Gateway custom
domain, 502ing every analytics beacon since launch; and ordinary WSDOT
read-timeout flakes needing one more retry. Rules: alarms are a queue
of distinct investigations, not one problem; and any code path only
production executes needs a query-shape or contract test, because mocks
cannot fail the way the real service does.

## 1b. Alarms: page on what a human can DO

**The alarm caught what I did not.** On 2026-08-24 a missing IAM action
of mine broke two cost fixes in production. `schedule-refresh-errors`
fired within ~15 minutes; I had looked at the metrics three hours earlier,
seen `PairDatesPublished: None`, and read it as "no publishes" rather than
"no metrics emitted, because the handler died before the emit". Alarms
earn their keep by catching the author's own blind spot - which is an
argument for keeping them sensitive, and a separate argument for making
sure each one is actionable enough that its email still gets read.

**A flapping alarm is worse than no alarm** (`weather-degraded`,
retuned 2026-08-22). It summed last-good fallbacks over 3 h with a
threshold real flaky days clear routinely, so it oscillated across the
line - and with `ok_actions` also wired, every oscillation double-tapped
the ops topic: eight emails in one afternoon for a condition that never
changed. Worse, the condition was **not actionable**: AirNow returning
502s is precisely what the last-good fallback exists to absorb, and no
human can fix a third party's weekend.

Rules:
- Alarm on the actionable question, not the observable one. "AirNow
  hiccuped" is observable; "no fresh reading in 12 h, so our key or
  endpoint is probably dead" is actionable. Same metric, different
  question.
- Keep the metric, change the alarm. `LastGoodFallbacks` is the honesty
  meter and belongs on a dashboard forever; only the paging threshold
  was wrong.
- Wire `ok_actions` only where the recovery itself is news. Recovery
  from someone else's outage is not.
- Set thresholds from MEASURED distributions, not intuition: pull the
  metric's real values first (3 h sums ran 23-73 against a threshold of
  30), then place the line above every observed benign day and below the
  genuine failure.
- **Alarm cost is never the reason to delete an alarm.** At $0.10 per
  alarm-month the entire 20-alarm set is ~$1/mo. The same review
  reversed an earlier "trimmable" note on `stats-data-lag` and
  `analytics-empty-night`: re-reading them showed each catches a
  distinct silent failure (publishing succeeds on rotten evidence) that
  `stats-not-fresh` cannot see, and neither has ever fired falsely.
  Judge alarms by signal and noise; the dimes are irrelevant.

## 2. Cost: never trust upstream's word for "changed"

**The invalidation burn (#76, `3fa720a`).** WSDOT flips the terminals
`cacheflushdate` token on essentially every 15-minute poll while the
served bytes stay identical. Trusting the token made the dims refresher
republish and CloudFront-invalidate `/data/terminals.json` 96x/day
since launch. July hid it inside the 1,000 free invalidation paths;
August exhausted them on the 10th and billed ~$0.50/day - the bulk of
the month's budget overrun. Fix: keep the token as the cheap first
gate, then hash the exact bytes we would publish and compare against
the stored hash; identical means store the token, emit `DimsTokenChurn`,
publish nothing. The schedule refresher had the same disease (`32ca4d7`).
Rules: gate every publish/invalidate on a content hash of the bytes you
serve, not on upstream change signals; sort collections before
serializing so ordering can't masquerade as change; free tiers hide
cost bugs - watch request COUNTS, not just dollars, in month one.

**The same disease, twice more (2026-08-23/24, #121 and #127).** The
invalidation burn was one instance of a general rule, not a one-off.
WSDOT's schedule `cacheflushdate` moves on essentially EVERY check -
measured 96/96 runs - so rebuilding on it re-fetched all 538 pair-dates
every 15 minutes: 53,466 requests/day to publish 80 files. And the alerts
watermark, which is genuinely content-derived and honest, still fires
~10x/hour because WSF rewrites live delay bulletins as boats fall behind
("40 minutes behind for the 7:15 from Bainbridge" -> "35 minutes behind
for the 8:10 from Seattle"); each edit re-fetched all 38 of today's
schedules. **A delay is not a timetable change.** Both are now governed
by elapsed time rather than by the upstream signal.

Rules: when an upstream "something changed" signal drives expensive work,
measure how often it fires versus how often the CONTENT it describes
actually changed. Ask what the signal literally means, not what you hope
it means. And where the answer is "rarely", let elapsed time govern the
work and keep the signal only for the fast path a user waits on.

**Metrics can name the wrong side of a transaction.** `PairDatesUnchanged:
53,386/day` reads on a dashboard as the content gate SUCCEEDING - 53,386
needless writes prevented! It is equally a count of 53,386 needless HTTP
requests to a state agency, and nothing framed it that way. It sat there
for a week. Name the cost, not just the save.

**Estimates that count invocations silently assume one request each.** The
"~3 requests/minute" figure in this doc was written at design time from
three pollers at roughly one invocation a minute. True for three of the
four collectors; the fourth fanned one invocation into 538 calls, making
the real number ~44/minute. It was repeated to the owner and went into an
email to WSDOT before anyone measured it. Re-derive published figures from
production before quoting them to an outside party.

**Still open, known and priced:** S3 Tier-1 request volume (~66k
PUT-class/day, ~23x the original estimate - candidate fix is batching
raw archive writes) and the timestamp-nondeterministic Lambda zips that
make every infra apply show ~19 spurious changes, which trains reviewers
to skim diffs. Both are documented in the observability runbook; noise
that masks signal is a cost too.

## 3. Honesty in metrics, logs, and user-facing state

**A fallback indistinguishable from success is the worst bug** (the
WallaWalla lesson, M4): a swallowed exception returning a default looks
exactly like success. Every fallback emits a metric and a log line;
`#49` (stats silently swallowing a dim-read failure) was the same
disease.

**Every failure counter carries its reason to the log** (#107): the
vessels poller wrote `last_error` to DynamoDB meta but never to
CloudWatch, so during the TLS incident its log group showed bare
`PollFailure` counts while its siblings showed the exception - and the
sibling logs were checked a day late. If the reason had been in the
first log group read, the false flag likely never forms.

**Measure the promise, not the convenient timestamp** (#92): notifier
latency anchored on the bulletin's stored `first_seen_ms`, so a WSF
text edit re-notified with "latency" of 6,782,343 ms - the bulletin's
age - poisoning the p95 SLO. The SLO promises time-from-THIS-observation;
that is what gets measured now.

**Staleness speaks the data's clock, never the wall clock** (#99): the
outage banner initially told users how long the PAGE had been open, not
how old the data was. `lastGoodAt` now derives from the snapshot's own
`generated_at`.

**Absence is a statement and gets labeled** - an overfull sailing says
"Full", never "-15 spaces" (#56); an empty overnight capacity feed is
not a claim about the terminal (#47); weather beyond the forecast
horizon renders as honestly absent; every stat carries window + n.

## 4. Third-party API realities

**Politeness is also strategy.** Every WSDOT request carries a
descriptive User-Agent with the site URL and a contact address, at ~3
requests/minute against a feed designed for 5-second polling. When the
outage looked like a block, that record is what made a good-faith
outreach email possible at all.

**Undocumented means verify everything empirically.** `vesselhistory`
loses boats SILENTLY if names are percent-encoded instead of
space-stripped (#42, 200 `[]` - indistinguishable from an empty
window); its VesselId column is corrupt (join on name); the
cacheflushdate token churns without content changes (#76); auth
failures are 400-with-Message, never 401 (client taxonomy). The
exploration-first workflow (`api-exploration-*/`) exists because every
one of these was found by probing, not reading.

**No SLA means build for absence**: last-good fallbacks with the OLD
`as_of` stamp (metered, per theme 3), degraded modes, and a poller that
publishes what it has rather than dying mid-run (#95).

## 5. Static export and CDN traps

- A `useSearchParams` Suspense boundary placed too high leaves the
  prerendered body EMPTY - hoist the server-rendered shell above it.
- `NEXT_PUBLIC_*` inlining needs literal `process.env.X` member
  expressions at build time; cross-module constant folding does not
  happen.
- The masthead clock baked at build time made every visitor hydrate
  against a stale string and throw React #418 (#80) - server renders a
  placeholder the client swaps.
- CloudFront forwarding the viewer Host header to an API Gateway custom
  domain 502s at the origin (#77) - use `AllViewerExceptHostHeader`.
- **Stacking order is a documented convention, not free integers.** The
  vessel card sits at z-index 31 specifically so "an open bottom sheet
  should cover the chrome below it", and the nav drawer at 39/40 "must stay
  on top of everything". Raising the route panel to 60 to escape the notice
  stack (50) silently beat both, and the circle drew over an open card for
  two days. Read the comments before changing a z-index; raise only the
  element that needs it, only while it needs it.
- DOM map markers have no collision engine: label layout is a design
  system (zoom gates, stagger axes, below-hangs - #104/#105), and the
  marker's anchored box must be the hull alone or the anchor drifts
  (#84).

## 6. Testing lessons

- Reproduce bugs end-to-end first, as the user experiences them - the
  TLS fix shipped only after a local strict-client repro failed and
  then passed (#107).
- MapLibre ignores synthetic wheel/dblclick events - drive it with
  trusted Playwright input; gliding markers never look "stable" to
  hover waits, so chase the hull with raw mouse moves and target only
  markers that receive their own center point.
- Mocks cannot fail like production (#77's Athena type error) - pin
  query shapes and contracts where only production runs the real thing.
- `cmd | tail` masks the exit code - it hid a pytest collection error
  and a ruff failure in one session. Run checks unpiped.
- Test module basenames must be workspace-unique or pytest collection
  collides.

## 7. Process and tooling

- Never a relative-path `rm` in a command chain's cleanup tail: after a
  mid-chain failure the working directory is unknowable, and it deleted
  the master copy of a needed tool twice in one day. Better: tools that
  must live near `node_modules` get committed to the repo and run in
  place (`web/scripts/screenshot-tour.mjs`) - copy-in/delete-after
  patterns are fragile by construction.
- CI path filters must include every directory that changes an
  artifact: a services/libs-only merge once shipped no Lambda because
  the apply workflow only watched `infra/**`.
- **Merged, applied, and working are three different states.** On
  2026-08-24 two cost fixes were merged, applied by CI, and silently dead
  in production for four hours. Do not report the third when you have only
  observed the second.
- **Changing a DynamoDB call type changes the IAM action it needs.**
  `_write_horizon` moved from `put_item` to `update_item` - correct in
  itself - but the role's policy still listed only `PutItem`. The rebuild
  ran, the stamp write threw `AccessDenied`, and the invocation failed
  AFTER the expensive work. Worse, `_save_hashes` and the metric emit both
  sat below that line, so a second unrelated gate silently stopped
  persisting and the metrics that would have shown it were never written.
  moto-based tests run against a table with no IAM at all and can never
  catch this class.
- **IAM inline-policy limits differ by identity type**: 2,048 bytes on a
  USER, 10,240 on a ROLE. The identical policy shape applied cleanly to a
  role and failed with 409 `LimitExceeded` on a user in the same apply.
  Reach for a managed policy (6,144) for anything non-trivial.
- **Locally-applied Terraform needs an explicit profile.** `infra/envs/prod`
  is only ever applied by CI, where credentials come from the OIDC role, so
  nothing in the repo names a profile - and `infra/bootstrap`, the one
  state applied by hand, falls through the credential chain to EC2 IMDS and
  fails on a laptop. Use `AWS_PROFILE=ryan terraform -chdir=infra/bootstrap ...`.
- **Split a PR by blast radius, not by feature.** A Terraform role
  definition is inert until applied and merges safely; the workflow change
  that starts USING that role breaks every deploy if it lands first.
  Shipping them together forced a manual dance; splitting them reduced the
  owner's part to one command.
- **A verification test can be wrong before the control is.** A guardrail
  check reported that an S3 write had succeeded because `grep upload`
  matched "upload **failed**". Read the full error, then confirm the
  outcome from a second identity - the object's absence, not the command's
  exit path.
- Review infra plans before merging even with green CI - the check that
  matters is "updated in-place" vs "must be replaced" on stateful
  resources (the Cognito user pool holds real accounts).
