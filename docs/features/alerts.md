# F3: Delay and cancellation alerts

Living reference for PRD F3. Updated whenever the feature changes.
Architecture decisions: [ADR-0006](../adr/0006-alert-subscriptions-delivery.md).

## Goal

One plain-language email when WSF cancels or delays sailings on YOUR
crossing in YOUR time window - p95 <= 2 min from the bulletin reaching
our feed, never spam (dedup + caps), every alert traceable to its WSF
source bulletin.

## Target user

The commuter: subscribed to Seattle-Bainbridge 16:00-19:00, wants the
4 PM cancellation email and does not want the 4 AM one.

## The pipeline (all live as of 2026-07-30)

1. **Sensor**: 1-min alerts poller; digest watermark (any bulletin
   appearance/edit/withdrawal moves it); invokes the notifier with the
   full slim feed, watermark written last (crash = harmless repeat).
2. **Notifier** (`wsf-prod-notify-fanout`, reserved concurrency 1):
   diffs ALERTS/BULLETIN# state, classifies NEW/UPDATED/GONE, fans out.
3. **Parser** (`wsf_core.alert_parse`): cancellation prose ->
   (time, dep, arr) triples; fails closed (unknown code poisons the
   text). Hit -> precise window match. Miss -> route-level fallback in
   [window_start - 2 h, window_end] of publish time, honestly labeled
   "we couldn't determine the specific sailings". Corpus at ship time:
   52 distinct real texts, 51 non-cancellation, 1 cancellation (parses
   clean) - n=1; ParseCoverage tells the real story over time.
4. **Delivery**: raw-MIME SES sends with List-Unsubscribe +
   List-Unsubscribe-Post (RFC 8058) + References threading headers;
   per-recipient claims (3/bulletin, 10/day LA-time); one bad recipient
   never aborts a fan-out; send-audit JSON line per send (bulletin id,
   user, latency, precision vs fallback) - the PRD's measurability.
5. **Hygiene**: SES events -> suppression Lambda: complaint/permanent
   bounce deletes all subscriptions + writes EMAIL#/SUPPRESS (checked at
   subscribe time, not in fan-out).

## Subscriptions

Cognito accounts (email sign-in, SRP, verified email) -> JWT-authorized
CRUD on /v1/subscriptions: pair + window (validated against the pairs
index; route derived at write; TransactWrite of the USER#/ROUTE# item
pair + the EMAIL#/USER pointer; natural-key idempotent; 10-sub cap).
Frontend: /account (sign-in machine), /alerts (manager: crossing picker,
window preset chips, custom times), /unsubscribe (button page, token in
the URL fragment). Entry points: map drawer + "Get alerts for this run"
on pair pages. Pairs without an upstream route id (ana-sj) are refused
with honest copy.

## Failure-capture / improvement loop

Every parse miss: ParseMisses metric + ParseMiss log line (bulletin id +
full text) + the raw S3 alerts archive (permanent corpus). Misses become
curated rules + regression tests; production stays deterministic. No
LLM in the send path; an offline verified-grounding tier is the
documented option if ParseCoverage proves the regex weak.

## Status

- 2026-07-30: D1-D3 + W1 live (PRs #32-#35). SES production-access
  request filed (sandbox until AWS approves). Bulletin state seeded from
  the live feed (7 bulletins, 0 sends - no subscribers yet).
- 2026-08-18: **first real delivery.** Owner's address verified in the
  sandbox; a genuine WSF bulletin (117236, Chimacum elevator outage,
  Sea/Brem) was detected by the live poller, matched a Bremerton->Seattle
  subscription via the publish-time window rule (status alert, nothing
  to parse - correctly no "couldn't determine" line), and landed in a
  real inbox. Fan-out latency 4,240 ms observed-to-SES-accepted
  (AlertSend audit line); with the 1-min poll cadence on top, worst-case
  detection-to-inbox is ~65 s against the 2-min SLO. First data point:
  within SLO.
- Sandbox IAM gotcha (PR #82): in sandbox, SES authorizes the
  RECIPIENT's verified identity as a resource alongside the sender's.
  The notifier policy carries a temporary `SandboxRecipientIdentities`
  statement (account-own identities wildcard) marked REMOVE at grant -
  found live via the SendFailure audit log naming the missing ARN.
- Remaining for M3 exit (W2), all gated on the production-access grant
  (case reopened + answered 2026-08-18): Cognito email sender switch to
  SES (confirmation codes out of spam) -> remove the "check spam" signup
  copy -> remove the sandbox IAM statement -> PRD acceptance walk +
  ADR-0003 tile revisit at exit review.
