// How large the longest ferry draws on screen.
//
// Was 44px, which put a 460' Jumbo Mark II at 44x13 and a 274' Kwa-di
// Tabil at 26x8 on a 390px phone - small enough that the traced WSDOT
// profiles read as pale dashes and the class differences were invisible.
// 68px keeps the strict length proportion (the point of tracing real
// profiles) while making the boats the loudest thing on a ferry map,
// which is what they should have been all along.
export const VESSEL_ANCHOR_PX = 68;

// Boats grow as the rider zooms in. The anchor size above is tuned for
// the fitted overview (~z9.6); a fixed pixel size meant zooming in grew
// the scenery while the boats stayed put, so they read as SHRINKING
// exactly when the rider leaned in to look at one. True geographic
// scale is not the goal (a 460' Jumbo would be 11px at z13 - the boats
// are deliberately super-scale); this is a gentle multiplier, clamped
// so the overview keeps its tuned look and close zooms stay tasteful.
// Replaces the old one-step 52px `z-lo` shrink with a continuous ramp.
export const VESSEL_SCALE_BASE_ZOOM = 9.6;
export const VESSEL_SCALE_RATE = 0.35; // +35% of anchor size per zoom level
export const VESSEL_SCALE_MIN = 0.8;
export const VESSEL_SCALE_MAX = 2.4;

export function vesselScaleForZoom(zoom: number): number {
  const s = 1 + (zoom - VESSEL_SCALE_BASE_ZOOM) * VESSEL_SCALE_RATE;
  return Math.min(VESSEL_SCALE_MAX, Math.max(VESSEL_SCALE_MIN, s));
}
