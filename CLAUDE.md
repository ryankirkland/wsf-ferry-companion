## Data Sources
- **WSF Traveler Information API (WSDOT Ferries)** (REST/JSON): Read `api-exploration-wsdot-ferries/wsdot-ferries.md` before writing code against this API; full column definitions in `api-exploration-wsdot-ferries/facts.json`, raw payloads in `api-exploration-wsdot-ferries/samples/`, human reference in `api-exploration-wsdot-ferries/report.html`.
  - Coverage for the five v1 features: supports realtime vessel map + ambient wall display (vessellocations, ~5 s refresh, 100% join to vessel dim, n=21; filter stale TimeStamp and handle yard terminal 122); supports on-time statistics with multi-year backfill (undocumented vesselhistory, data verified back to 2002-03, departures only - no actual-arrival field); supports trip-focused schedules + fares (schedule/{date} pairs match fares pairs 38/38; faretotals basket math verified); partial delay/cancellation alerts (alerts + timeadj + bulletins cover the signal but are poll-only and cancellations are free text - no push channel, parsing required); partial terminal drive-up capacity (terminalsailingspace covers 13 of 20 terminals and 23 of 38 pairs - measured over 319 snapshots / 9,111 departures 2026-07-31, correcting an earlier unverified "~6" - current-state only, empty overnight; history requires self-built snapshots; terminalwaittimes is static boilerplate, unusable for live waits).

- **NWS (api.weather.gov) + AirNow (EPA)** (REST/JSON): Read `api-exploration-weather/weather.md` before writing code against either; terminal->gridcell resolution is PINNED in `services/weather/src/wsf_weather/gridcells.json` (rounding-sensitive - never re-derive in production; rerun `tools/weather/resolve-gridcells.py` to update). 20 of 21 terminals covered (Sidney B.C. is the labeled gap); AirNow key is an SSM SecureString set via CLI.

## Features
- **F1 Realtime vessel map**: see `docs/features/realtime-map.md` for goals, dependencies, and why it is shaped this way (snapshot serving, staleness rules, dedup). Update that file whenever the feature changes.
- **F3 Email alerts**: see `docs/features/alerts.md` for the poller->notifier pipeline, the fail-closed prose parser + fallback honesty rules, dedup/cap semantics, and Cognito/SES auth decisions (ADR-0006). Update that file whenever the feature changes.
- **F2 Trip planner**: see `docs/features/trip-planner.md` for the four `/data` contracts, the verified (VesselID, depart_ms) join, signal-engine honesty rules, and the fares/timeadj traps. Update that file whenever the feature changes.
- **F1 asset tooling**: `tools/vessel-icons/` traces the map silhouettes and `tools/vessel-drawings/` mirrors WSDOT's class profile drawings for the vessel card. Both commit the script + MANIFEST and gitignore the images - WSDOT artwork stays out of the repo.
- **F4/F5 Stats + capacity**: see `docs/features/stats.md` for the sync->transform->stats chain, the two `/data/stats` contracts, and the honesty rules that shape them (window+n on every number, n<30 slot degradation, reconciliation-based cancellation with its floor caveat, labeled collection gaps). Update that file whenever the feature changes.
- **Site analytics**: see `docs/features/site-analytics.md` (and ADR-0007) for the beacon->collector->nightly-aggregate->`/admin/analytics` pipeline, the visitor-hash and coarse-geo privacy rules, the Cognito `Admins`-group gate, and the consent/opt-out copy. Update that file whenever the feature changes.

## Frontend engineering standards
- **Vercel React/Next.js best practices**: `.claude/skills/vercel-react-best-practices/` (vendored from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), MIT) - 70 performance rules prioritized by impact. Apply when writing or reviewing anything under `web/`. Start with `SKILL.md`; read individual `rules/*.md` for the categories a change touches.
- **Next.js reference docs**: version-matched docs ship inside the installed framework at `web/node_modules/next/dist/docs/` (Vercel's replacement for the retired `next-best-practices` skill). Consult them for App Router / static-export questions instead of the (possibly newer) public website.
- Static-export lens: this site is `output: "export"` - no request-time server, so `server-*`/API-route rules apply only to build-time code, and hydration rules matter doubly (every page prerenders at build).

- **F6 Weather**: see `docs/features/weather.md` for the NWS+AirNow poller, the pinned gridcell dim, the /data/weather.json contract, and the honesty rules (as_of = forecaster publish time, last-good fallbacks always metered, labeled absences). Update that file whenever the feature changes.

## Operations
- **Learnings**: `docs/learnings.md` is the living retrospective - diagnosis discipline (the TLS false flag), cost lessons (the invalidation burn), honesty rules, API quirks, testing traps. Add to it whenever an incident or fix teaches a transferable rule.
- **Observability**: `docs/runbooks/observability.md` covers reading application logs (13 Lambda log groups + the EMF metric namespaces), tracking cost (the two budgets, the run-rate command, what July actually decomposed to), and user activity - homegrown site analytics (see above) now covers page views, clicks, referrers, and coarse geography; CloudFront access logging itself remains off (the analytics pipeline is a separate first-party beacon, not raw request logs, and never persists IPs). Update it when monitoring changes.

## General Guidelines
- Never use the em dash. Use the plain dash "-" instead.
- When writing commit messages, NEVER auto-add your agent name as co-author.
- When making technical decisions, do not give much weight to development cost. Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- In that same vein, when designing components, modularity is key. Avoid long, monolithic files.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would experience it. This makes sure you find the real problem so your fix will actually resolve it.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection. If something clearly looks off, even if it is not diretly related to what you are doing, try to get it fixed along with your current task.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness. If you see one, even if it is not caused by what you are working on right now, still get it fixed.
- Always explain your solutions, what alternatives you considered, and why you proceeded with your selected path.
- When a new feature gets added, create a dedicated markdown file for it for reference later. This markdown file should describe the goal for the feature, the target user, feature dependencies, and why it is implemented the way it is. This file should be updated every time the feature is updated. Add a "Features" section to CLAUDE.md if one does not exist and a note to reference this feature markdown file to learn more about that feature.
- An up-to-date ERD and Architecture flow chart must be maintained
