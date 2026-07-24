## Data Sources
- **WSF Traveler Information API (WSDOT Ferries)** (REST/JSON): Read `api-exploration-wsdot-ferries/wsdot-ferries.md` before writing code against this API; full column definitions in `api-exploration-wsdot-ferries/facts.json`, raw payloads in `api-exploration-wsdot-ferries/samples/`, human reference in `api-exploration-wsdot-ferries/report.html`.
  - Coverage for the five v1 features: supports realtime vessel map + ambient wall display (vessellocations, ~5 s refresh, 100% join to vessel dim, n=21; filter stale TimeStamp and handle yard terminal 122); supports on-time statistics with multi-year backfill (undocumented vesselhistory, data verified back to 2002-03, departures only - no actual-arrival field); supports trip-focused schedules + fares (schedule/{date} pairs match fares pairs 38/38; faretotals basket math verified); partial delay/cancellation alerts (alerts + timeadj + bulletins cover the signal but are poll-only and cancellations are free text - no push channel, parsing required); partial terminal drive-up capacity (terminalsailingspace covers only a subset of terminals, current-state only, empty overnight - history requires self-built snapshots; terminalwaittimes is static boilerplate, unusable for live waits).

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
