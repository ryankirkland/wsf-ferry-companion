# ADR-0003: Vector tile hosting for the map

- **Status:** Accepted (2026-07-28, alongside ADR-0001)
- **Context:** Phase B validated MapLibre GL + OpenMapTiles-schema vector tiles
  restyled at runtime (ADR-0002). The remaining question is who serves the
  tiles. Research checked 2026-07-24; citations inline.

## Findings

**OpenFreeMap public instance** ([openfreemap.org](https://openfreemap.org/),
[github.com/hyperknot/openfreemap](https://github.com/hyperknot/openfreemap)):
unlimited map views, no keys, commercial use explicitly allowed; OSM
attribution mandatory. Explicitly **no SLA**; run by a single maintainer and
funded by donations. The full stack (tiles, fonts, sprites, styles) is open
and self-hostable, which is the stated mitigation if the public instance
degrades.

**Self-hosted Protomaps extract** ([docs.protomaps.com/deploy/aws](https://docs.protomaps.com/deploy/aws)):
`pmtiles extract` against the daily planet build produces a Washington bbox
archive estimated 0.5-2 GB (planet z0-15 is ~120 GB; US+Mexico measured 17 GB).
Documented AWS pattern: PMTiles in private S3 + tiny Lambda translating
`z/x/y` to range requests + CloudFront (~125 ms p50 / 800 ms p99 at the
Lambda). Estimated cost at our scale: effectively **$0/month at 100 DAU**
(inside CloudFront's always-free 1 TB / 10M requests) and **~$2/month pricing
a 5k-DAU spike with zero free tier applied**. Refresh = re-extract on a
schedule (monthly is plenty for coastlines and towns).

**Glyphs and sprites** are plain static files in both ecosystems - trivially
mirrored to S3/CloudFront, and self-hosting them is a prerequisite for the
Gabarito map-glyph delight anyway.

## Decision (recommended)

1. **Launch on the OpenFreeMap public instance** with mandatory attribution -
   zero cost, zero infrastructure, terms explicitly permit it.
2. **Self-host glyphs/sprites/style JSON from day one** (S3 + CloudFront):
   removes the most fragile third-party surface, enables brand fonts later,
   and costs pennies.
3. **Build and keep a tested self-host fallback**: generate the WA PMTiles
   extract during M1, deploy the documented S3 + Lambda + CloudFront stack
   behind an internal URL, and verify the app runs on it end to end. Style
   URL is a config value; switching providers is a deploy, not a migration.
4. Promote the self-hosted path to primary if OpenFreeMap shows instability,
   or when the cost-of-reliability conversation (real users depending on
   alerts) says a donation-funded single-maintainer service should not be on
   the critical path. Revisit at M3 (alerts) exit.

## Consequences

- No tile cost at launch; ~$2/month worst-case when self-hosting activates.
- One more M1 deliverable (the fallback deployment + switch test).
- The dependency risk is explicitly owned and time-boxed rather than
  discovered during an outage.

## Amendment (2026-07-29, during M1 build-out)

The fallback archive is generated with **Planetiler** (`--area=washington`,
Geofabrik extract), not `pmtiles extract` against the Protomaps daily planet
build as originally written. Discovery during implementation planning: the
Protomaps planet build uses the Protomaps basemap **schema**, which is
incompatible with our positron-derived style and the recolor heuristics
proven against it; Planetiler emits **OpenMapTiles-schema** tiles - the same
toolchain OpenFreeMap runs - so the style fork works unchanged. The S3 +
Lambda + CloudFront serving pattern, internal posture, and cost envelope are
unchanged. Build/refresh/switch-test procedure: `tools/pmtiles/RUNBOOK.md`.

## Decision at the M4 exit review (2026-08-01): stay on OpenFreeMap

The standing item from step 4 above - "revisit at M3 exit" - carried
through M3 and M4 without being written down. Closing it now.

**Recommendation: keep OpenFreeMap primary; keep the self-hosted PMTiles
path armed and tested.** No change to what is deployed.

Evidence gathered 2026-08-01:

- **No observed instability.** The map has served ferrysound.com
  continuously since 2026-07-29. A 10-tile probe across zooms 8-12 returned
  10/10. The client already carries the tripwire that would tell us
  otherwise: `controller.ts` counts tile errors in a rolling 60-second
  window and raises a non-fatal `degraded` event at 8, which surfaces the
  degraded banner. It has not fired in normal operation.
- **The fallback is not theoretical.** `/tiles/*` answers 200 today, and
  the switch has been exercised end to end (`tools/pmtiles/RUNBOOK.md`).
  Switching is a config change to the style URL - a deploy, not a
  migration - so the cost of being wrong is one deploy.
- **The cost-of-reliability trigger has not arrived.** That trigger was
  "real users depending on alerts". There is currently 1 account and 2
  subscriptions, both mine. Promoting a ~$2/month always-on dependency to
  serve one user would be paying for reliability nobody is relying on yet.

**Revisit when any of these is true**, rather than at a date:

1. The degraded banner fires in normal operation, or tile errors appear in
   a way users would notice.
2. Subscriber count reaches double digits - i.e. strangers depend on this.
3. OpenFreeMap announces funding or availability changes.

The honest summary: this is the same decision as before, now with evidence
behind it instead of an unexamined default, and with named triggers so it
does not quietly carry forward a third time.
