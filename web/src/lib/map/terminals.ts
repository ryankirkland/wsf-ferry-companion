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
  9: { label: "Fauntleroy", minor: true },
  10: { label: "Friday Harbor", minor: true },
  11: { label: "Coupeville", minor: true },
  12: { },
  13: { label: "Lopez", minor: true },
  14: { label: "Mukilteo" },
  15: { label: "Orcas", minor: true },
  16: { label: "Pt. Defiance", minor: true },
  17: { label: "Port Townsend", minor: true },
  18: { label: "Shaw", minor: true },
  20: { label: "Southworth", minor: true },
  21: { label: "Tahlequah", minor: true },
  22: { label: "Vashon", minor: true },
  122: { label: "Eagle Harbor yard", soft: true, minor: true },
};

/** Zoom at or above which every terminal names itself. Below it, only the
 *  anchors do. Twenty DOM labels at the default framing collided outright -
 *  SOUTHWORTH over VASHON, FAUNTLEROY over White Center - because these are
 *  plain markers with no collision engine behind them. The dots stay at
 *  every zoom, so a terminal is never invisible, only unnamed. */
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
    el.className = [className, hint.soft ? "soft" : "", hint.minor ? "minor" : ""]
      .filter(Boolean)
      .join(" ");
    // Vertical stack: (weather chip - prepended by controller.syncWeather)
    // over name over dot; the dot's center sits on the coordinate via the
    // bottom anchor. A map without weather data is simply a map without
    // chips.
    el.innerHTML = `<span>${hint.label ?? term.name}</span><i></i>`;
    el.dataset.terminal = String(term.id);

    return new maplibregl.Marker({
      element: el,
      anchor: "bottom",
      offset: [0, 4],
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
  const extras = ["Bainbridge Island", "Vashon", "Friday Harbor", "Port Townsend"];
  return [...new Set([...terminals.map((t) => t.name), ...extras])];
}
