# Design Delights Backlog

Polish and joy items deliberately parked so phases keep moving (see the
design-phase guardrail: "good enough, then forward"). Pick these off during
milestones, never as blockers.

- **Per-vessel silhouettes.** Current paper ferry reads submarine-ish. End
  state Ryan wants: each marker recognizably THE boat it represents (Jumbo
  Mark II vs Kwa-di Tabil profiles differ visibly). Source material:
  vesselverbose class drawings (`Class.DrawingImg`/`SilhouetteImg` URLs in
  the WSF API). Start with one silhouette per CLASS (8 classes covers the
  fleet), not per vessel.
- **Cut-paper coastline shadow, done right.** The offset blurred-line
  approach rendered as dark splotches on convoluted shores (removed
  2026-07-24). Alternatives to try later: lower-zoom-only application,
  fill-extrusion hack, or a preprocessed simplified coastline GeoJSON.
- **Continuous sun-position palette blending.** Ambient mode drifting
  through golden hour on the real solar clock instead of three discrete
  modes.
- **Wake trails.** Gradient GeoJSON lines fading behind moving vessels
  (line-gradient with lineMetrics), replacing the CSS dash under markers.
- **Brand glyphs on the basemap.** Convert Gabarito to PBF glyphs,
  self-host, so map-rendered labels match the brand type.
- **Arrival ripple.** A soft pulse when a vessel reaches dock.

## UX decisions parked 2026-07-30 (new-user walkthrough)

Awaiting Ryan's design call - mechanics all shipped, these are taste:

- **Boat-button discoverability**: the drawer FAB is an unlabeled circle;
  every nav path hides behind it. Options: one-time gentle pulse on first
  visit (lean), tiny "Menu" caption, or promote Trips/Alerts into the top
  bar at desktop widths.
- **First-visit orientation**: nothing tells a newcomer boats are
  tappable. One-time dismissible whisper ("Tap a boat - the boat button
  has trips & alerts") vs. keeping the map perfectly quiet.
- **Ambient-mode entry**: one tap from the drawer into a chromeless
  takeover with no warning; guests may not know how to leave.
- **Trip picker**: no browse-all-crossings view (From->To only). Fine for
  v1; revisit if terminal-first browsing feels wrong.

## Parked 2026-07-31 (phone walkthrough of the deployed app)

The same walk fixed six things in PR #50 - vessel scale, the terminal set,
the FAB-over-attribution collision, town-label weight, the calendar legend,
and the default framing. These two need more than a tuned constant:

- **Docked boats stack into a clump.** Two or three hulls overlap at
  Seattle and Vashon and read as one shape; enlarging the icons made it
  more obvious. `cluster.ts` declutters moored *labels* ("Sealth +2") but
  nothing moves the icons. Wants real collision handling - fan the boats
  around the terminal, or collapse a berth into one marker with a count.
  Sized on its own, not bolted onto an icon-scale change.

- **Mode switcher owns the top of a phone screen.** AUTO/DAY/DUSK/NIGHT is
  an aesthetic preference sitting in the most valuable strip of the map,
  above anything a rider came for. Candidate for the drawer, leaving the
  masthead and clock. Deliberately not changed unilaterally: it was a
  deliberate design-phase choice and it is Ryan's taste to spend.
