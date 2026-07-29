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
