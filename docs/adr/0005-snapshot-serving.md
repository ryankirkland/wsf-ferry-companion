# ADR-0005: Snapshot-on-S3 serving for the realtime map

- **Status:** Accepted (2026-07-29)
- **Amended (2026-08-24):** The per-vessel `FLEET#/VESSEL#` rows are retired.
  This ADR kept DynamoDB as "the hot-state system of record (M2 trip queries
  and M3 alert evaluation read it server-side)" and called the snapshot "a
  read-optimized projection of it". The projection half held; the system-of-
  record half never did. M2 shipped as a static export with no server-side
  trip query at all, and M3's alert evaluation reads `ALERTS#`, `PAIR#`,
  `USER#` and `EMAIL#` - never `FLEET#`. An audit on 2026-08-23 found the
  partition costing ~93,000 write units/day (~$3.30/mo, ~99% of the table's
  writes) to maintain 21 items, each overwritten ~4,400x/day, against 207
  read units per three hours account-wide - with no production reader in any
  service. The poller keeps writing the snapshot and the raw NDJSON archive;
  only the DynamoDB write is removed. Nothing rider-facing changes, because
  the map never read these rows.

  Two consequences worth stating plainly. **This is not a loss of position
  history** - the rows were current-state only, overwritten in place, and the
  raw archive (`raw/vessellocations/dt=.../`) is and always was the history,
  at full fidelity per poll. It is the substrate for any future wait-time or
  delay modelling. **The Gate-2 benchmark is retired with it** (it measured
  read latency against these rows to validate a serving path that was never
  built). If a server-side reader is ever wanted, reinstating a projection is
  a small change; paying for one speculatively is not.

- **Amended (2026-07-29):** Extended by M2 to the trip planner - the same
  pattern serves `/data/pairs/*`, `/data/fares/*`, and `/data/alerts.json`;
  the make-it-or-miss-it join stays client-side. Contracts and rationale in
  [trip-planner.md](../features/trip-planner.md).
- **Context:** M1 needs a serving path for fleet positions. The defining load
  is the ambient wall display: one tab polling every ~12 s for 8-24 h/day is
  ~144k requests/month - per tab. The PRD requires freshness p95 <= 30 s
  behind source, absorption of a 5k-DAU spike day with no manual action, and
  the <= $15/mo idle ceiling.

## Decision

The poller materializes a compact `fleet.json` snapshot (~1.5 KB gzipped) to
a dedicated data bucket on every poll; CloudFront serves it at
`https://ferrysound.com/data/fleet.json` with a ~5 s TTL and CORS. Clients
poll the edge. **No API Gateway or Lambda sits in the map's hot path.**
DynamoDB remains the hot-state system of record (M2 trip queries and M3 alert
evaluation read it server-side); the snapshot is a read-optimized projection
of it, produced at write time.

Compared with the conventional client -> API Gateway -> Lambda -> DynamoDB
path, viewer cost changes from linear in tabs (~$1.7/mo extra at 100 DAU,
~$9/day per thousand all-day ambient tabs in API Gateway alone) to O(1):
origin load is bounded by TTL x active edge locations, not by viewers, and
CloudFront's always-free tier absorbs every modeled load point. Latency drops
to edge-cache reads and availability sheds the Lambda dependency.

Freshness arithmetic (15 s poll loop): p95 ~= 22 s at edge fetch, ~= 28 s
including the ambient client's poll interval - inside the 30 s SLO, with the
deterministic worst case at 37 s as accepted rare tail.

## Consequences

- The snapshot schema is a **versioned public contract** (`"v": 1`); breaking
  changes require a new file, not a mutation.
- There is no general fleet API until M2 builds one for trip queries.
- The client detects pipeline death via `generated_at` aging, not HTTP errors.
- Dims ship the same way (`/data/vessels.json`, `/data/terminals.json`,
  including the synthetic terminal 122 row).

## Rejected along the way

- **Overnight reduced cadence:** WSF is dark ~2 h/day; savings < $0.25/mo
  against DST-aware schedule complexity. The 24/7 loop also keeps the archive
  complete and the staleness path continuously exercised.
- **DLQ on the poller:** a scheduler tick carries no replayable payload and
  every poll is idempotent-per-tick - the next tick IS the retry. The
  poller-gap alarm covers the real failure mode.
- **Conditional writes for dedup:** a failed condition check still bills a
  write unit; the in-memory TimeStamp cache (valid because reserved
  concurrency = 1) bills nothing.
