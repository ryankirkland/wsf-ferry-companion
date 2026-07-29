# Product Requirements: WSF Ferry Companion (working title)

| | |
|---|---|
| **Status** | Draft v0.1 - approved scope, pending Phase B (design) and Phase C (architecture ADR-0001) |
| **Owner** | Ryan Kirkland |
| **Last updated** | 2026-07-24 |
| **Decisions log** | [docs/adr/](adr/) |

## 1. Vision

A joyful, beautiful, reliable companion for Washington State Ferries riders - and a celebration of the ferry system itself. Commuters get an honest answer to the only questions that matter ("where is my boat, will I make it, is it late?"). Ferry lovers get a live map gorgeous enough to hang on a wall. The product should feel whimsical and clean at once: playful about ferries, serious about data.

This is also a portfolio flagship: pure-play AWS, infrastructure as code, and a documented end-to-end process (PRD, design exploration, ADRs, milestone loops) that demonstrates how the builder works, not just what got built.

## 2. Goals and non-goals

**Product goals**
1. Real riders rely on it weekly, especially for delay awareness.
2. The map is beautiful enough that people run it as ambient art.
3. Every stat is trustworthy: measured, evidence-backed, honestly labeled.

**Personal goals (explicit, they shape decisions)**
- Depth in AWS: every hosting/auth/data/alerting need solved with AWS services, managed as Terraform.
- A honed, repeatable build process; this repo is the reference example.

**Non-goals for v1**
- No vehicle reservation integration or booking of any kind (WSF's system, not ours).
- No native iOS/Android apps (responsive web + PWA installability instead).
- No coverage beyond Washington State Ferries (no BC Ferries, no water taxis).
- No user-generated content (comments, reports, photos).
- No SMS alerts in v1 (deferred to v2): US carrier sender registration adds weeks of lead time, a compliance surface (opt-in proof, carrier-mandated privacy language), and fixed monthly cost for a channel email already covers. Revisit when real subscribers ask for it.

## 3. Personas

1. **The commuter (primary).** Rides Seattle-Bainbridge or Mukilteo-Clinton daily. Wants: "next sailings for MY run, right now, with live make-it-or-miss-it truth" and an email or push nudge when the run degrades. Zero patience for stale data.
2. **The ferry enthusiast / wall-display owner.** Loves the system, runs the ambient map on a spare monitor or wall tablet all day. Wants: beauty, motion, calm; glanceable state of the whole fleet; zero chrome.
3. **The data-curious rider.** Asks "is the 4:40 always late?" and "which boat is the most reliable?" Wants: honest historical stats with real denominators (cancellations excluded), not vibes.

## 4. V1 features

### F1. Realtime vessel map (the centerpiece)
Live fleet positions on a map of Puget Sound: vessel markers with heading/speed, route lines, terminal markers, docked-vs-underway states, out-of-service messaging, and vessel detail (name, class, capacity, current run, delay vs schedule).

**Ambient mode ("frame on a wall"):** a first-class fullscreen, chromeless view. Self-updating forever without interaction, no session timeouts, subtle motion, day/night aware. URL-addressable (e.g. `/ambient`) so a wall tablet can boot straight into it.

*Acceptance criteria*
- Positions render within the freshness SLO during service hours; stale vessels (source timestamp older than 5 min) are visually distinguished, never plotted as live.
- Vessels laid up at Eagle Harbor (terminal 122) and out-of-service vessels display honestly (badged, not hidden, not "sailing").
- Ambient mode runs 24 h unattended in a browser without memory growth breaking it, and recovers automatically from network drops.
- The map reads beautifully at both phone size and TV-across-the-room distance.

### F2. Trip-focused schedules and fares
"Next sailings from X to Y right now": upcoming departures for a terminal pair with live context per sailing - assigned vessel, its current position/delay, and an honest make-it-or-miss-it signal. Includes trip fare lookup (passenger/vehicle fare line items for that terminal pair) and day-view schedule browsing.

*Acceptance criteria*
- A commuter can answer "do I run for the 5:30 or relax for the 6:20?" in under 10 seconds from page open.
- Departure times reflect WSF cancellations/additions (tidal cancellations included), never the raw seasonal PDF schedule.
- Fares shown match WSF's published fares for the selected terminal pair and rider type; fare data is labeled with its effective date.
- Terminal pairs with no remaining sailings today say so plainly and show tomorrow's first sailings.

### F3. Delay and cancellation alerts
Users subscribe to routes (or specific terminal pairs + time windows). When WSF signals a delay/cancellation affecting a subscription, we notify: **email (SES) at launch, web push next; SMS is v2** (see non-goals). Alert content is plain language: what happened, which sailings affected, current best estimate.

*Acceptance criteria*
- Delivery within the alert SLO from the time WSF's feed shows the alert.
- No duplicate notifications for the same underlying event (updates to one event thread, not spam); per-user daily caps enforced.
- Users manage subscriptions and channels themselves (verified email, push permission).
- Alert precision is measurable: every sent alert links to the source WSF bulletin.

### F4. On-time performance statistics
Historical reliability, powered by a multi-year backfill (2012+) of scheduled-vs-actual departures: on-time % (within 10 min) by route/vessel/season/time-of-day, delay percentiles (p50/p90), cancellation rates, and fun superlatives (most punctual boat, roughest month).

*Acceptance criteria*
- Cancelled sailings are excluded from on-time denominators and reported as their own rate.
- Every headline stat states its window and sample size; skewed metrics report percentiles, never bare means.
- Route pages answer "is MY usual sailing typically late?" (time-of-day granularity).

### F5. Terminal capacity views
Live drive-up space per upcoming departure for the terminals that report it (Seattle, Bainbridge, Bremerton, Edmonds, Mukilteo, Clinton). Everywhere else: an honest "WSF does not publish this for this terminal."

*Acceptance criteria*
- Capacity gauges show percentage full with the departure they refer to; never shown for non-reporting terminals.
- Data older than a few minutes is labeled stale, not presented as live.

## 5. Service level objectives (draft - confirm in Phase C)

| SLO | Target | Notes |
|---|---|---|
| Map position freshness | p95 <= 30 s behind source during service hours | Source updates ~5 s; our poll + pipeline budget |
| Alert delivery latency | p95 <= 2 min from WSF bulletin visibility | Measured poll-to-delivery |
| Site availability | 99.5% monthly | Public-facing pages |
| Trip planner correctness | Cancellations reflected <= 2 min | Same feed as alerts |
| Stats freshness | Daily by 06:00 PT | History syncs overnight |
| Poller continuity | No realtime gap > 5 min during service hours | Gaps in positions/capacity are unrecoverable |

## 6. Success metrics

- Weekly active users; 4-week retention of alert subscribers.
- Active alert subscriptions; alert opt-out rate (spam signal).
- Alert quality: precision (alerts that matched a real disruption) and latency vs SLO.
- Ambient mode: sessions > 30 min (the wall-display signal).
- Cost per month vs budget; zero secret leaks; SLO attainment.

## 7. Cost constraint (binding)

- **Idle cost hard ceiling: <$15/month** (all environments, steady state, excluding one-time domain registration). Costs may scale with real usage, not with idleness.
- Consequences accepted up front: no ALB-fronted always-on compute (~$16+/mo fixed), no NAT gateway (~$32/mo), no Aurora Serverless v2 floor (~$44/mo). Architecture must scale to zero or near-zero.
- The full architecture decision is [ADR-0001](adr/0001-architecture-cost-bakeoff.md) (Phase C): a costed bake-off between a serverless lakehouse (~$3-8/mo) and a minimal Postgres core (~$18-25/mo, requires explicit ceiling exception if chosen).
- Ritual: monthly cost review against this section; billing alarm at $10 and $15.

## 8. Data source and risks

Single upstream: the **WSDOT/WSF Traveler Information API** (four REST sub-APIs: vessels, terminals, schedule, fares). Free, no rate limits documented. Authoritative reference: `api-exploration-wsdot-ferries/` (regenerated 2026-07-24 with the four sub-APIs; see CLAUDE.md Data Sources for the pointer and the feature-coverage verdict).

| Risk | Impact | Mitigation |
|---|---|---|
| `vesselhistory` (powers F4) is undocumented upstream | Stats backfill/refresh could vanish without notice | Archive every raw pull to S3; design actuals to be re-derivable from position snapshots |
| Realtime feeds are current-state only | Poller downtime permanently loses positions/capacity history | Poller continuity SLO, gap monitoring, boring-reliable ingestion path |
| Access code unenforced today, required by ToS | Silent enforcement change breaks ingestion | Always send code; canary alert on the API's actual auth-failure signature: HTTP 400 + JSON `Message` (no 401/403 exists in this API) |
| Source identity quirks (name-only joins, 1900-sentinel times, phantom terminal 122) | Silent data corruption if unhandled | Encode in one shared library with tests; quarantine unknown identities |
| Single maintainer | Ops burden, bus factor | Scale-to-zero architecture, alarms over dashboards, runbooks in docs/ |

## 9. Roadmap

| Milestone | Delivers | Exit criteria |
|---|---|---|
| **M0 Foundations** | Repo/CI, exploration artifacts, ADR-0001 decided, Terraform skeleton + billing alarms, domain | `terraform apply` produces the walking skeleton; cost alarms live |
| **M1 The Map** | F1 incl. ambient mode, on the real domain | A stranger calls it beautiful; ambient runs 24 h on a wall tablet |
| **M2 Trip planner** | F2 schedules + fares | Commuter answers run-or-relax in <10 s |
| **M3 Alerts** | F3 email+push, Cognito auth | Real subscribers receive a real disruption within SLO |
| **M4 The Numbers** | F4 stats with 2012+ backfill, F5 capacity | Route pages answer "is my sailing usually late?" |

Order rationale: the map first because it is the soul of the product and the design phase's proving ground; alerts before stats because real users rely on them; stats last because the backfill is valuable but nobody is waiting on it.

## 10. Open questions

1. Design direction: resolved in **Phase B** via 2-3 interactive mood boards (brief: whimsical, joyful, clean, celebrates WSF; map as wall art).
2. Architecture: resolved in **Phase C** via ADR-0001 bake-off under the $15 ceiling.
3. Naming + domain: working title only; decide with the design direction.
4. WSDOT attribution/ToS review before public launch.
