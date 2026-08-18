# F1: Realtime vessel map

Living reference for the product's centerpiece (PRD F1). Updated whenever
the feature changes.

## Goal

Live fleet positions on a Paper Sound map of Puget Sound, honest to the
second: every marker states what it is (underway, docked, resting at the
yard, or stale), and nothing stale is ever plotted as live. Includes the
ambient "frame on a wall" mode (`/ambient`) that runs unattended for days.

## Target users

- **The commuter**: glances at the map to answer "where is my boat, really?"
- **The wall-display owner**: runs ambient mode on a spare screen all day;
  the map is furniture that happens to be true.

## Dependencies

- Upstream: `vessellocations` (~5 s server refresh, polled at 15 s),
  `vesselverbose` + `terminallocations` dims (re-fetched only when the
  sub-API `cacheflushdate` token moves).
- Verified quirk handling lives in `libs/wsf-core` (the PRD-mandated shared
  library): .NET dates, staleness precedence (stale > yard > docked >
  underway), synthetic terminal 122, the 400+Message auth signature.
- Serving: ADR-0005 snapshot on S3 behind CloudFront (`/data/fleet.json`,
  ~5 s TTL, CORS). No API Gateway in the hot path.
- Design: ADR-0002 Paper Sound; tiles per ADR-0003 (OpenFreeMap public
  instance + self-hosted style/glyphs/sprites + PMTiles fallback).

## Why it is built this way

- **Snapshot serving** makes viewer cost O(1): an ambient tab polling all
  day costs the same as none (CloudFront absorbs it); freshness p95 ~22 s
  at the edge against a 30 s SLO. Full trade study in ADR-0005.
- **Write-dedup on TimeStamp** halves DynamoDB idle cost (~$0.98 vs $2.27
  per month); validated by the `VesselsWritten` metric.
- **Staleness is computed at ingest and carried everywhere** because
  out-of-service vessels keep positions up to 45 days old - a map that
  trusts row presence draws ghost ferries.
- **The archive stores raw rows verbatim** (not parsed models): parsing
  drops fields by design; the archive's job is preserving what upstream
  actually said, for M4 replay.

## Status

- Data path: **live** (2026-07-29). `https://ferrysound.com/data/fleet.json`
  + dims; alarms tested end to end (auth canary fired on the deploy-time
  placeholder and cleared when the real code landed). Gate-2 in-region
  p95 ~20 ms recorded in ADR-0001.
- Frontend: **live** (2026-07-29). The full map with all four vessel states,
  vessel detail card (honest delay rules with plausibility caps), and
  `/ambient` with the 24 h guarantees (wake lock, 04:10 reload,
  outage-recovery reload).
- Freshness SLO measured at the edge 2026-07-29: rendered-position age
  p95 ~= 29 s vs the 30 s SLO (10 samples over 2 min + client interval;
  ADR-0005 predicted 28.2 s).
- Outstanding: the 24 h ambient soak on a physical tablet, and the
  "stranger calls it beautiful" gate - both Ryan-side; the PMTiles switch
  test records into tools/pmtiles/RUNBOOK.md.

## Vessel markers under zoom (2026-08-18)

Two rider-reported fixes, verified by trusted-input e2e (map-zoom.spec):

- **Boats grow as you zoom in.** They were fixed-px (68px anchor, one
  52px step below the declutter zoom), so zooming in grew the scenery
  while boats stayed put - reading as SHRINKING exactly when the rider
  leaned in. Now a continuous scale (`vesselScaleForZoom`: 1.0 at the
  ~z9.6 overview, +35%/level, clamped 0.8-2.4) rides a `--vm-scale` CSS
  var set by the controller and applied as a transform on `.boat` - not
  the marker element (MapLibre owns its transform) and not the svg
  (which carries the flip). True geographic scale is deliberately NOT
  the goal (a Jumbo would be 11px at z13); boats stay super-scale.
- **The lat/lon pins the hull's center.** The name/ETA labels used to
  flow inside the marker's anchored box, so `anchor: center` centered
  boat-plus-labels and pushed the hull ~14px above its true position
  whenever labels were visible (hidden-label zooms measured 1px - the
  offset WAS the siblings' height). Wake and labels are now absolutely
  positioned out of the box; the box is the boat; the e2e asserts sub-2px
  with labels shown.

## Landing bundle discipline (2026-08-18)

The Vercel best-practices audit measured the landing page at 2.04 MB of
initial JS; it now ships ~0.66 MB. Three rules keep it that way:
maplibre-gl and VesselCard load via `next/dynamic` (the map chunk streams
behind the same LoadingVeil; the card chunk preloads on idle so a marker
tap never waits), the BoatFab decides its "Account"/"Sign in" label from
the Cognito SDK's own localStorage key instead of importing the 109 KB SDK,
and dev fixtures are guarded by a literal `process.env.NODE_ENV ===
"development"` test in each consuming module so production builds
tree-shake them (cross-module constant folding does not happen - the
literal must be in the consumer). VesselSchedule consumes `usePairDay`, not
`useTripData`: the combined hook started a permanent alerts poll from a
card disclosure.

## Vessel class icons (2026-07-30)

Each of the 7 vessel classes renders its own silhouette, vector-traced
from WSDOT's official class profile drawings by
`tools/vessel-icons/build_icons.py` (regenerate with `uv run` on that
script; output is the committed `web/src/lib/map/vessels/class-icons.ts`).
Marker widths scale with real vessel length from a single anchor,
`VESSEL_ANCHOR_PX` (460' Jumbo Mark II = the anchor; 274' Kwa-di Tabil
proportionally smaller). Layers reuse the existing mode tokens
- hull/win/cabin plus the new `--keel` - so the dusk/night lantern
windows work per class for free. Vessel->class comes from the dims feed;
the pool retrofits markers created before dims resolve and falls back to
the Issaquah silhouette for unknown classes. Reference photos/drawings
stay out of the repo; only the traced originals ship.

## Legibility pass (2026-07-31)

A phone-viewport walk of the deployed map found the subject of the map was
the quietest thing on it. Four changes, all measured before and after:

**Vessel scale.** Boats rendered 26-37 px wide and 8-11 px tall on a 390 px
phone - the traced WSDOT profiles read as pale dashes and the class
differences were invisible. `VESSEL_ANCHOR_PX` moved 44 -> 68, keeping
strict length proportion (the reason for tracing real profiles at all).
The zoomed-out sizes moved with it; a constant left behind would have made
zooming out a collapse rather than a step.

**Terminals come from the dim.** The map labelled 5 of 20 terminals: the
anchor table was a hardcoded central-Sound list from the M1 prototype, so
Clinton and Mukilteo sat unnamed in the DEFAULT view with a ferry docked at
Clinton. `addTerminalMarkers` now takes the terminals dim, filtered by
`servedTerminalIds()` to what the live pairs index still sails to - which
also keeps Sidney B.C. (route ended 2019) off a map of where you can catch
a boat today. An unreachable pairs index means "no opinion" and draws
everything, never nothing.

**Labels are zoom-gated.** Twenty DOM labels at the default framing
overlapped outright (SOUTHWORTH over VASHON, FAUNTLEROY over White
Center); these are plain markers with no collision engine. Minor terminals
name themselves from `LABEL_ALL_ZOOM` (11.4); their dots never leave, so a
terminal is never invisible, only unnamed.

**Attribution.** The boat FAB sat on top of the credits, rendering
"Terrain: Mapzen via AWS Open Data" as "apzen via AWS Open Data".
Attribution is a licensing obligation, so on narrow screens it collapses to
the "i" that MapLibre's compact mode exists for. A Playwright spec asserts
the two never overlap.

Basemap town labels are also dimmed (55% opacity, 85% size): Woodway and
SeaTac were rendering brighter than the ferries.

## WSDOT class drawing on the vessel card (2026-07-31)

Tapping a boat shows WSDOT's official profile drawing for its class,
mirrored into the map-assets bucket by `tools/vessel-drawings/` (script and
MANIFEST committed, images gitignored - same convention as
`tools/map-assets/`, and it keeps WSDOT artwork out of a public repo).

Three constraints the data imposed:

- **Slugs come from `ClassName`, never `PublicDisplayName`.** `Issaquah`
  and `Issaquah 130` both display as "Issaquah" and have different
  drawings; a display-name key silently merges two classes.
  `wsf_core.vessel_classes.class_slug` is the one source shared by the
  mirror script and the published dim.
- **The white background stays.** These are dark line drawings made for
  white paper; knocking the background out erases the hull outline on a
  dusk or night card. The card gives them a light plate instead.
- **It is a class drawing, not a portrait.** All five Issaquah 130s share
  one, and `VesselDrawingImg` is null for all 21 vessels, so the caption
  says "WSDOT class drawing" rather than implying it is that hull.

The drawing sits after the status lines: someone who taps a boat wants to
know where it is going, and an image above that answer pushes it down the
card. An image that fails to load removes itself rather than leaving a
broken frame.

Shipping it needs two credentialed steps - upload the mirror, then
`{"mode": "force-rebuild"}` on the dims refresher, because a new CONTRACT
field cannot wait for a WSDOT cacheflush that may be weeks away.

## Inline route schedule on the vessel card (2026-08-03)

"Next sailings" on `VesselCard` used to be a plain link out to the full
`/trip/{pair}` planner page, abandoning the map. Tapping it now expands the
card in place: a sticky toggle row (the same label, now with a chevron)
reveals a scrollable schedule section underneath the existing name/status/
drawing content, built entirely from F2's existing pieces -
`useTripData`/`buildDayView`/`computeSignal`/`DepartureList`/`DateStrip` -
via a new `VesselSchedule` component
(`web/src/components/vessel/VesselSchedule.tsx`). Zero new backend or data
work; this is a client-side reuse of a pipeline that already ships.

**Scope is the vessel's current route, not a cross-route boat schedule.**
Ryan's call: riders think "what's the whole Bremerton-Seattle schedule
today," not "everywhere this hull goes." The pair is fixed to whatever
`PAIRS` lookup matched when the card opened (same lookup the old link
used); if the boat swaps routes while the card stays open, the schedule
does not follow it live - a documented limitation, not a bug. A boat with
no determinable current pair (yard, out of service) shows no control at
all, unchanged from before.

**Day range is today..+13**, the same horizon and the same DateStrip
component the trip planner uses, so an out-of-range date degrades exactly
the same way. Defaults to today on every open - expansion state and the
selected day both reset when a different vessel is selected (React's
"adjust state during render" pattern, not an effect, so it never fires a
redundant render): the day last browsed for one boat must never bleed into
the next boat you tap.

**Only the toggle button is sticky**, not the date strip beneath it - it
pins to the top of the schedule's own scroll container
(`.scheduleWrap[data-expanded="true"]`, capped at `min(50vh, 420px)`) so
the collapse control is reachable at any scroll depth, matching Ryan's
explicit ask ("no matter how far the user scrolls there's just always that
chevron there"). No gesture library: this is a tap-triggered expand, not a
finger-drag sheet - "swipe up" in the original ask described intent, not a
literal drag physics (confirmed with Ryan).

**Found and fixed while building this**: a boat with no class drawing
renders a shorter collapsed card, short enough that the "Next sailings"
toggle landed in the boat FAB's own bottom-left footprint. The FAB
(`z-index: 30`) was drawing its circle over the toggle's label because the
card's `z-index: 26` lost that fight. An open bottom sheet should cover the
chrome underneath it, not contend with it for the same pixels - the card's
`z-index` moved to 31 (still under the nav drawer/backdrop at 39/40).
Guarded by a Playwright regression test alongside the existing
FAB-vs-attribution one.
