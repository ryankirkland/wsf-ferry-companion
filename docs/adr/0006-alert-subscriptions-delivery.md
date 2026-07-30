# ADR-0006: Alert subscriptions and delivery

- **Status:** Accepted (2026-07-30)
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

**No DynamoDB Streams - the notifier owns all diff state.** The 1-min
alerts poller stays a dumb sensor: on digest change it async-invokes
the notifier with the full slimmed feed (~25 KB), then writes its
watermark LAST. The notifier diffs against ALERTS/BULLETIN# items with
regression-guarded conditional writes. Every crash window degrades to a
duplicate invoke absorbed by per-recipient claims; Streams would add a
second delivery machine for one producer and one consumer. (Supersedes
the ADR-0001 fan-out sketch.)

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

**Effectively-once delivery per (user, bulletin, text-version).**
Claim-before-send on USER#/SENT# items (conditional writes), max 3
sends per bulletin per user, 10/day per user counted in
America/Los_Angeles, both claimed atomically. GONE marks never delete
bulletin state (TTL 90 d) so an empty-feed flap cannot re-notify.
Reserved concurrency 1 serializes fan-outs. A dropped async event is
NOT regenerated next minute (unlike the pollers), so the notifier gets
an OnFailure destination to the ops topic and a deliberate 1 h maximum
event age: a stale alert still beats silence.

**Suppression before reputation.** SES configuration-set events (SNS)
drive automated handling: complaint or permanent bounce -> suppression
item + both subscription sides deleted via the EMAIL#/USER pointer.
Suppression is checked at subscribe time, never in the fan-out hot
path. Latency is anchored to first_seen_ms (when OUR poller first saw
the bulletin), per the PRD's poll-to-delivery definition; upstream
publish lag is instrumented separately.

## Consequences

- Event threads are BulletinID-scoped (v1 limitation, documented): WSF
  sometimes posts a new bulletin for the same incident. Stable Subject +
  References headers let mail clients thread; daily caps bound the rest.
- Subscriptions are the table's first non-re-derivable data: PITR is on.
- Web push (PRD "next") reuses this exact fan-out; only the transport
  changes. SMS remains v2 per the PRD non-goal.
- Cost: SES cents/month at any plausible subscriber count, Cognito free
  to 10k MAU, PITR cents - ~+$0.30/mo against the $15 ceiling.
