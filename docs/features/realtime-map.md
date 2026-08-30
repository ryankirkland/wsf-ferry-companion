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

## The boats ARE the drawings now (2026-08-18)

Owner's beauty-gate call after a side-by-side A/B at real map sizes: the
map markers use WSDOT's official class drawings with the page background
extracted (border-flood-fill, interior whites preserved - see
tools/vessel-drawings/MANIFEST.md), served as `<slug>-t.png` beside the
card's white-plate originals. The frontend derives the `-t` URL from the
dim's `drawing` field; class footage still sets marker width, so a
Jumbo reads longer than a Kwa-di Tabil. The vector-traced icons remain
in the bundle as the fallback for a class without a drawing or a failed
asset load - an empty marker is never acceptable.

Costs accepted with eyes open: the dusk "lantern moment" (windows going
amber via the --win token) is retired - raster art has no themable
layers - and night mode instead tames the white superstructure with a
brightness filter. If the lantern is missed in practice, revisit.

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

**Boat names and status are hover-only** (owner's 2026-08-20 call:
labels on every hull read as clutter - the silhouettes carry the map).
Name + status live in a small paper tip that appears on hover and never
takes pointer events; click still opens the full vessel card, and touch
- which has no hover - goes straight there. The tip stays absolutely
positioned outside the marker's layout box so anchor:center keeps the
lat/lon pinned to the hull. This retired the z-lo and lbl-off
label-declutter CSS: hidden is now the default at every zoom, and a
hover is explicit enough intent to answer even on a moored-cluster
companion's "+N" carrier. E2E note: underway boats glide between
snapshots, so specs hover via chase-the-hull mouse moves, and the
hover target must be a marker that actually receives its own center
point (companions sit under another hull).

**Route filter** (owner's ask, 2026-08-20: "I care mostly about where
Bremerton and Southworth routes are - the others become noise"). A
circle above the boat FAB - two boats joined by a dotted S-curve, the
route as the map draws routes - opens a checkbox card keyed on the
fleet feed's eight OpRouteAbbrev strings (first placement was a pill
under the mode switcher; it sat on the masthead clock - owner's catch,
2026-08-21). While filtering, the circle fills accent and carries a
visible-route count badge, and the mobile notice stack floats above
the whole two-circle column. Below a divider, an "Out-of-service
boats" toggle (owner's follow-up: tied-up boats are dock clutter)
hides insvc-false vessels - these report no routes, so the route
checkboxes can never reach them; the badge counts routes only, but
either filter lights the accent fill. Stored at `fs.hide-oos:v1`,
default shown (`lib/map/routes.ts` -
curated taxonomy, unit-tested against the fixture so a new WSF route
fails a test instead of sailing unfilterable). Unchecking hides a
route's boats and its EXCLUSIVE terminals (Seattle stays while either
of its routes is visible); a boat reporting no routes (yard moves,
repositioning) is never hidden - filtering trims noise, it must not
make real boats vanish unaccountably. Hiding is the route-off class
(display:none), so pool bookkeeping, glide state, and DOM reuse stay
intact and toggling is instant. The basemap's dotted OSM ferry lines
stay - they are one class=ferry layer, not per-route features, and are
texture at 0.45 opacity. Preference persists per device
(`fs.hidden-routes:v1`); ambient applies it with no panel of its own -
a wall display of YOUR routes is the point. Account-level sync is a
candidate follow-up.

**Every rider port names itself at every zoom** (owner's 2026-08-20
walk, second round: the whole northern network - Anacortes, the San
Juans, Coupeville, Port Townsend - plus the Tacoma pair rendered as
bare dots until z11.4). `minor` is now exclusively the yard's tier.
The San Juans are the knot: Orcas/Shaw/Lopez dots sit within ~10px of
each other at the zoom floor, solved with the stagger axes - Orcas
holds the row above, Shaw hangs below-right, Lopez below-left, Friday
Harbor slides west - each label over its own island or open water
(verified by screenshot at z8 and z9). Their weather chips are
`chipLate`: name at every zoom, chip past the declutter zoom - three
staggered names fit in that blob, three 75px chips cannot. chipLate is
safe ONLY for ports outside the default phone framing (the trap that
sank the triangle's chip-hiding compromise); a unit test enforces that
the triangle never gets it.

**The Fauntleroy triangle staggers instead of demoting** (owner's
2026-08-20 walk: three commuter terminals vanishing at full zoom-out is
worse than any crowding). `LabelHint.stagger` slides names+chips sideways off the shared screen
row at far zoom (re-centering when there's room), and `below` hangs a
whole stack under its dot; the dots hold the coordinates throughout.
Fauntleroy staggers right; Southworth hangs below-left and Vashon
below-right, which is what lets all three carry weather chips at every
zoom - the first cut kept Southworth's stack above its dot and its chip
row collided with Bremerton's name from the zoom floor to ~z10, so the
chips deferred to the declutter zoom, and on a phone's default framing
(just under that zoom) the triangle showed no weather at all. Two
below-stacks can sit shoulder to shoulder where two above-stacks could
not. The map also gained `minZoom: 8`: full zoom-out is the whole
Sound, not the whole planet, which is what makes "legible at full
zoom-out" a testable guarantee. "White Center" and "Burien" joined the
suppressed basemap names - Fauntleroy's and Vashon's right-staggered
labels land on them.

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

The route line reads spatially: the actual left-at time and any completed
minutes of lateness sit above the origin terminal, while WSF's estimated
arrival sits above the destination. The scheduled departure remains a
separate comparison below rather than repeating either live time.

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
