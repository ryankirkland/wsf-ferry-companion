# ADR-0006: Alert subscriptions and delivery

- **Status:** Accepted (2026-07-30), amended (2026-08-28)
- **Context:** M3 delivers PRD F3: subscribe to crossings + time windows,
  email within p95 <= 2 min of the WSF bulletin becoming visible to our
  poller, no duplicate spam, per-user caps, self-service management,
  every alert traceable to its source bulletin. ADR-0001 sketched
  "DynamoDB Streams for notification fan-out" and "Cognito/SES" before
  any of it was designed in earnest; this ADR records what was actually
  built and where it deliberately departs from that sketch.

## Decisions

**Cognito accounts, SRP-only SPA client (per the PRD roadmap; Ryan's
call over signed-link-only subscriptions).** Email sign-in with
verified email, custom Paper Sound UI via amazon-cognito-identity-js -
no hosted UI, no password ever transiting our code or servers. HTTP API
JWT authorizer validates ID tokens natively; subscriptions key on the
Cognito `sub` claim (`USER#<sub>`), exactly the ERD sketched in M1.
Cognito emails ride COGNITO_DEFAULT until SES production access, then
switch to the SES identity.

**One-click unsubscribe stays token-based despite Cognito.** Gmail/
Yahoo mandate RFC 8058 one-click for bulk-ish senders, and nobody signs
in from a mail client. HMAC tokens (wsf_core.tokens) carry purpose, kid,
and version INSIDE the MAC; secrets live in SSM with current+previous
kids so rotation never breaks a link already sitting in an inbox.
Email-borne human links land on button pages - GET never mutates,
because mail scanners click everything.

**No DynamoDB Streams - notifier-owned diff, SQS-owned delivery retry.**
The 1-min alerts poller stays a dumb sensor: on digest change it
async-invokes the notifier with the full slim feed (~25 KB), then writes
its watermark LAST. The notifier diffs against ALERTS/BULLETIN# items,
evaluates every subscription before deduplicating users, and enqueues
one delivery per matched user. Bulletin state moves only after queueing,
so a crash becomes harmless duplicate SQS messages. Streams would still
add a second change-capture system without improving this boundary.
(Supersedes the ADR-0001 fan-out sketch and amends ADR-0006's original
direct-SES implementation.)

**Digest watermark.** The M2 `max_id:max_ms` watermark was blind to
edits of older bulletins and to withdrawals (a live M2 bug: withdrawn
alerts never left the site banner). Now a digest over sorted
(id, published_ms, normalized_text_hash) tuples - moves on ANY
appearance, edit, or disappearance.

**Pair + time-window subscriptions with a fail-closed parser (Ryan's
call for the fullest PRD wording).** WSF publishes per-sailing
cancellations only as prose; `wsf_core.alert_parse` extracts
(time, dep, arr) triples via a curated terminal-code map and fails
closed - one unknown code poisons the whole text, because a half-true
"affected sailings" list reads as "your boat is fine" to the person
whose sailing we failed to decode. Parse hit -> precise window match;
parse miss -> route-level fallback inside [window_start - 2 h,
window_end] of the publish time, honestly labeled. Missing a real
cancellation is the worse failure; caps bound the spam side.
ParseCoverage/ParseMisses metrics + ParseMiss text capture feed the
improvement loop (misses become rules + regression tests; no LLM in the
send path - an offline verified-grounding tier is the documented
fallback if real-world coverage proves weak).

**At-least-once delivery per (user, bulletin, text-version).** A
reserved-concurrency-1 delivery Lambda consumes one SQS message at a
time, verifies at least one matched subscription remains active, checks
suppression and the 3/bulletin + 10/day caps, sends through SES, then
transactionally records the USER#/SENT# and USER#/NOTIF# items.
Recording after SES makes transient send failures retryable. A
crash after SES acceptance but before DynamoDB commit can rarely
duplicate an email; this is the chosen side of the irreducible
cross-service atomicity gap because a duplicate is safer than a missed
cancellation. Duplicate queue messages after a committed send are
absorbed by the SENT record.

The source queue retries five receives, retains messages four days, and
moves exhaustion to a 14-day DLQ. Delivery Lambda errors, queue age over
the two-minute SLO, and DLQ depth alarm separately. The poller->notifier
async invoke keeps its one-hour retry window and OnFailure destination;
once matching succeeds, SQS is the durable recovery boundary.

**Suppression before reputation.** SES configuration-set events (SNS)
drive automated handling: complaint or permanent bounce -> suppression
item + both subscription sides deleted via the EMAIL#/USER pointer.
Suppression is checked both at subscribe time and immediately before
delivery. Matched subscription existence is also rechecked immediately
before delivery, covering messages queued before a bounce or unsubscribe.
Latency remains anchored to the observation time of the current text
version, per the PRD's poll-to-delivery definition.

## Consequences

- Event threads are BulletinID-scoped (v1 limitation, documented): WSF
  sometimes posts a new bulletin for the same incident. Stable Subject +
  References headers let mail clients thread; daily caps bound the rest.
- Subscriptions are the table's first non-re-derivable data: PITR is on.
- Web push (PRD "next") reuses this exact fan-out; only the transport
  changes. SMS remains v2 per the PRD non-goal.
- Cost: SES cents/month at any plausible subscriber count, Cognito free
  to 10k MAU, PITR cents, and SQS effectively inside its free tier at
  this volume. Three delivery alarms add about $0.30/month.
