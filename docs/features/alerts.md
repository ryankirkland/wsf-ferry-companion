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

## The pipeline

1. **Sensor**: 1-min alerts poller; digest watermark (any bulletin
   appearance/edit/withdrawal moves it - title, one-liner AND body);
   invokes the notifier with the full slim feed, watermark written last
   (crash = harmless repeat).
2. **Notifier** (`wsf-prod-notify-fanout`, reserved concurrency 1):
   diffs ALERTS/BULLETIN# state, classifies NEW/UPDATED/GONE, evaluates
   every subscription before deduplicating users, and writes one SQS
   delivery message per matched user. Bulletin state moves only after
   every message for that text version reaches SQS.

   Two keys, deliberately separate:

   - The **change-detection key** is `wsf_core.alerts.text_hash` = title
     + RouteAlertText, PINNED by a golden-value test. The body is
     outside it because this key lives in every BULLETIN#.text_hash, and
     moving its inputs would make every live bulletin look edited on the
     first poll after a deploy. `body_hash` is tracked beside it.
   - The **send key** is `send_hash` = text_hash + body_hash, which is
     what the email actually renders and what SENT#.last_hash dedups on.

   A body-only edit therefore moves the send key but not the change key:
   it re-notifies, and the email opens with "WSF has added new
   information to this notice since we emailed you" so a second email
   never reads as a bug (owner's call, 2026-09-03 - "it is okay to
   re-notify if we let the user know it is the result of receiving new
   information"). What bounds it is the existing cap: 3 sends per
   bulletin per rider, 10 per day, however often WSF edits. Whitespace
   churn is not an edit (`body_hash` normalizes it), and a bulletin
   stored before bodies existed adopting its FIRST body is not an edit
   either - nothing new was published, so nobody is emailed.
3. **Parser** (`wsf_core.alert_parse`): cancellation prose ->
   (time, dep, arr) triples; fails closed (unknown code poisons the
   text). Its input is RouteAlertText followed by the BulletinText body
   (since 2026-09-03) so a cancellation written only in the body fails
   closed instead of parsing as "nothing to extract". Hit -> precise
   window match. Miss -> route-level fallback in [window_start - 2 h,
   window_end] of publish time, honestly labeled "we couldn't determine
   the specific sailings". Corpus at ship time: 52 distinct real texts,
   51 non-cancellation, 1 cancellation (parses clean) - n=1;
   ParseCoverage tells the real story over time (the body widens its
   denominator - a ParseMisses step after the deploy is expected).
4. **Delivery queue** (`wsf-prod-notify-delivery`): SQS isolates each
   recipient, retries transient failures five times, and retains
   exhausted messages in a 14-day DLQ. Queue age, Lambda errors, and DLQ
   depth alarm independently.
5. **Delivery worker** (`wsf-prod-notify-delivery`, reserved concurrency
   1): checks that a matched subscription remains active, checks
   suppression and caps, sends raw-MIME SES with RFC 8058 unsubscribe +
   References headers, then records SENT state and daily count
   transactionally only after SES accepts. A crash after SES but
   before the record can rarely duplicate an email; this explicit
   at-least-once tradeoff prefers a duplicate over a silently missed
   cancellation.
6. **Hygiene**: SES events -> suppression Lambda: complaint/permanent
   bounce deletes all subscriptions + writes EMAIL#/SUPPRESS. Delivery
   rechecks both suppression and matched subscription existence so a
   message queued before a bounce or unsubscribe cannot send afterward.

## Subscriptions

Cognito accounts (email sign-in, SRP, verified email) -> JWT-authorized
CRUD on /v1/subscriptions: pair + window (validated against the pairs
index; route derived at write; TransactWrite of the USER#/ROUTE# item
pair + the EMAIL#/USER pointer; natural-key idempotent; 10-sub cap).
Frontend (renamed "Ferry Alerts" + split at the owner's 2026-08-19
walk): /alerts carries two tabs - "Your alerts" (the subscription
manager: crossing picker, window preset chips, custom times) and "All
active alerts" (every current WSF bulletin systemwide, straight from
/data/alerts.json with route names from the pairs index - public, no
account). /account is account management proper: email display,
Cognito password change (SRP, in-SDK), sign out; signed-out visitors
get the sign-in machine. /unsubscribe (button page, token in the URL
fragment) is unchanged. Entry points: nav drawer/side rail + "Get
alerts for this run" on pair pages. Pairs without an upstream route id
(ana-sj) are refused with honest copy.

## Failure-capture / improvement loop

Every parse miss: ParseMisses metric + ParseMiss log line (bulletin id +
the one-liner + the body, all public WSF prose) + the raw S3 alerts
archive (permanent corpus). Misses become
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
- 2026-08-19: second real delivery overnight (bulletin 117241), and its
  WSF text edit re-notified correctly - which exposed a latency-metric
  bug: AlertSend anchored on the bulletin's first sighting, so the edit
  reported 1.9 h of bulletin age as if it were fan-out speed, poisoning
  the p95 SLO metric. Latency now anchors on the invoke's own
  observed_at_ms - the moment THIS text version reached the feed.
- Sandbox IAM gotcha (PR #82): in sandbox, SES authorizes the
  RECIPIENT's verified identity as a resource alongside the sender's.
  The notifier policy carries a temporary `SandboxRecipientIdentities`
  statement (account-own identities wildcard) marked REMOVE at grant -
  found live via the SendFailure audit log naming the missing ARN.
- 2026-08-20: **production access GRANTED** (50,000/day, 14/sec).
  Same-day switch: Cognito sends DEVELOPER-mode through the ferrysound.com
  SES identity (DKIM-signed confirmation codes; an explicit
  sending-authorization policy on the identity permits cognito-idp,
  scoped to this pool), the "check spam" signup copy is gone, and the
  sandbox-era SandboxRecipientIdentities IAM statement is removed -
  recipients are no longer identities, so SendAlertEmail's domain scope
  is again the whole story. Alerts are now deliverable to ANY subscriber.
- 2026-08-28: fan-out split into match -> SQS -> delivery after a code
  review found two silent-loss windows: subscriptions were deduplicated
  before their time windows were evaluated, and claim-before-send made
  transient SES failures permanently ineligible for retry. Delivery is
  now at-least-once, per-recipient, DLQ-backed, and SENT state is written
  only after SES accepts.
- 2026-09-02: **ferrysound.com retired.** All senders (delivery Lambda and
  Cognito) had moved to the soundferries.com identity at the 2026-08-31
  cutover; the legacy SES identity, its DKIM/MAIL FROM/DMARC records, its
  cognito-sending policy, and the legacy hostnames (site, www, api) are
  deleted, and the delivery role is pinned to the single primary identity
  again. The cutover itself briefly broke delivery (see PR #156) because
  that pin lagged the sender switch - with one identity there is no pair
  to drift apart.
- 2026-09-03: **the Labor Day email said nothing.** Bulletin 117482
  ("Service during Labor Day weekend") reached the owner as its title
  printed twice, no body, no caveat. Root cause: ingest kept only
  AlertFullTitle and RouteAlertText, and WSF fills RouteAlertText with
  the title verbatim for most bulletins (6 of 9 in the exploration
  sample, 2 more near-verbatim); the substance lives in BulletinText,
  which was never read. The email then printed title + text without the
  web banner's `alertBody` de-duplication. No caveat was correct by the
  existing rule (nothing mentioned cancelling, so nothing was missed)
  but blind: the parser never saw the body. Fix: `body` (BulletinText,
  HTML -> plain multi-line text) in the Alert model, `/data/alerts.json`
  and the notifier payload; email = title once + every text that adds
  to it (`wsf_core.alert_text.alert_details`, the Python twin of the
  web rule); parser reads text + body; notification key unchanged and
  pinned (see step 2) so the deploy re-emails nobody.
- M3 exit remaining: PRD acceptance walk + ADR-0003 tile revisit.
