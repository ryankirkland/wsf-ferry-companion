# ADR-0002: Design direction is Paper Sound on real geography

- **Status:** Accepted (2026-07-24)
- **Context:** The PRD required "whimsical, joyful, clean, celebrates WSF" with a
  map worth hanging on a wall, and deferred the visual call to Phase B. Taste
  calibration narrowed to illustrated warmth; three boards explored intensity.

## Decision

Adopt **Paper Sound**: cut-paper flat color, paper grain, soft shadows, ferry
green, Gabarito + Inter - applied to **real geography** (MapLibre GL, vector
tiles recolored to tokens at runtime, open-data hillshade for real mountains)
rather than stylized illustration. Full tokens and map language:
[docs/design/direction.md](../design/direction.md).

## Alternatives considered

- **A - Saltwater Storybook** (max illustration): strongest wall drama, but the
  largest ongoing asset budget, and review moved away from invented scenery
  ("focus on a legitimate map") - custom-illustrated geography lost.
- **C - Evergreen Line** (minimal): cheapest to maintain, striking night mode,
  but reads closest to a generic tracker; whimsy depended entirely on motion
  and copy. Kept as an influence (declutter discipline, luminous night markers).
- **B on illustration** (original board): the winning vibe, but judged
  impossible to evaluate honestly without real map tiles; superseded by B2.

## Consequences

- The real-map prototype (`moodboards/paper-sound-map.html`) validated the
  frontend map approach: MapLibre + free vector tiles + runtime restyling +
  HTML markers. Tile *hosting* (public OpenFreeMap vs self-hosted PMTiles on
  S3/CloudFront) is an architecture decision - goes in Phase C with ADR-0001.
- Textures are baked per mode (patterns are not runtime-tintable) - two grain
  bakes, maintained together.
- Per-class vessel silhouettes, Gabarito map glyphs, coastline paper shadow,
  and continuous sunset blending are parked in
  [docs/design/delights.md](../design/delights.md); none block milestones.
- Review discipline observed for the record: one round of specific fixes
  (splotch removal, viewport re-measure), then locked at "good enough" per
  the project's stated guardrail.
