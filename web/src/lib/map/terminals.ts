// Terminal markers: a vertical stack of weather chip over tracked-caps
// name over dot, centered on the coordinate.
//
// The list comes from the terminals dim, not a hardcoded table. The
// original six anchors were the M1 prototype's central-Sound framing, and
// they left Clinton and Mukilteo unlabeled in the DEFAULT phone view with
// a ferry sitting at Clinton - boats with nowhere to be going.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import type { TerminalDim } from "@/lib/data/dims";

export interface LabelHint {
  /** Dimmer treatment: not a place a rider boards. */
  soft?: boolean;
  /** Shorter label where the dim's official name crowds the map. */
  label?: string;
  /** Names itself only once zoomed in - see LABEL_ALL_ZOOM. */
  minor?: boolean;
  /** Collision-avoidance placement for terminals that share a screen row
   *  at far zoom. "left"/"right" slide the name+chip sideways while the
   *  dot stays on the coordinate (far zoom only - centered when close);
   *  "below" hangs the whole stack under the dot at every zoom. */
  stagger?: "left" | "right" | "below";
}

/** Per-terminal treatment, keyed by TerminalID. Markers stack
 *  vertically - weather chip over name over dot (owner's call,
 *  2026-08-19: the old sideways rows sprawled across the water and
 *  hid the boats), so shore side no longer matters. */
export const LABEL_HINTS: Record<number, LabelHint> = {
  1: { label: "Anacortes", minor: true },
  3: { label: "Bainbridge" },
  4: { },
  5: { label: "Clinton" },
  7: { label: "Seattle" },
  8: { label: "Edmonds" },
  9: { label: "Fauntleroy", stagger: "right" },
  10: { label: "Friday Harbor", minor: true },
  11: { label: "Coupeville", minor: true },
  12: { },
  13: { label: "Lopez", minor: true },
  14: { label: "Mukilteo" },
  15: { label: "Orcas", minor: true },
  16: { label: "Pt. Defiance", minor: true },
  17: { label: "Port Townsend", minor: true },
  18: { label: "Shaw", minor: true },
  20: { label: "Southworth", stagger: "left" },
  21: { label: "Tahlequah", minor: true },
  22: { label: "Vashon", stagger: "below" },
  122: { label: "Eagle Harbor yard", soft: true, minor: true },
};

/** Zoom at or above which every terminal names itself. Below it, only the
 *  anchors do. Twenty DOM labels at the default framing collided outright
 *  because these are plain markers with no collision engine behind them.
 *  The dots stay at every zoom, so a terminal is never invisible, only
 *  unnamed. The Fauntleroy/Vashon/Southworth triangle shares one screen
 *  row at far zoom yet must survive full zoom-out (owner's 2026-08-20
 *  call) - hence `stagger`, which slides or hangs those labels instead of
 *  demoting them to minor. */
export const LABEL_ALL_ZOOM = 11.4;

export function servedTerminals(terminals: TerminalDim[], servedIds: Set<number>): TerminalDim[] {
  // No index means no opinion about what is served, so draw everything -
  // filtering on an empty set would leave a map of nothing but the yard.
  if (servedIds.size === 0) return terminals;
  return terminals.filter((t) => servedIds.has(t.id) || LABEL_HINTS[t.id]?.soft);
}

export function addTerminalMarkers(
  map: MLMap,
  className: string,
  terminals: TerminalDim[],
): Marker[] {
  return terminals.map((term) => {
    const hint = LABEL_HINTS[term.id] ?? {};
    const el = document.createElement("div");
    el.className = [
      className,
      hint.soft ? "soft" : "",
      hint.minor ? "minor" : "",
      hint.stagger ? `stag-${hint.stagger}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    // Vertical stack: (weather chip - prepended by controller.syncWeather)
    // over name over dot; the dot's center sits on the coordinate via the
    // bottom anchor. A map without weather data is simply a map without
    // chips. A "below" stagger reverses the column (CSS) and anchors at
    // the top, so the dot still owns the coordinate with the stack
    // hanging under it.
    el.innerHTML = `<span>${hint.label ?? term.name}</span><i></i>`;
    el.dataset.terminal = String(term.id);

    const below = hint.stagger === "below";
    return new maplibregl.Marker({
      element: el,
      anchor: below ? "top" : "bottom",
      offset: [0, below ? -4 : 4],
    })
      .setLngLat([term.lon, term.lat])
      .addTo(map);
  });
}

/** Basemap town labels we replace with our own terminal markers, so the
 *  same place is never named twice in two typographic voices. */
export function suppressedTownNames(terminals: TerminalDim[]): string[] {
  // The dim's names double as the basemap's for most towns; the ones that
  // differ are listed alongside rather than instead, since a miss here is
  // only a duplicate label, never a missing one.
  // White Center rides with Fauntleroy: its basemap text sits exactly
  // where Fauntleroy's right-staggered label lands at far zoom.
  const extras = ["Bainbridge Island", "Vashon", "Friday Harbor", "Port Townsend", "White Center"];
  return [...new Set([...terminals.map((t) => t.name), ...extras])];
}
