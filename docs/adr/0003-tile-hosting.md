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
