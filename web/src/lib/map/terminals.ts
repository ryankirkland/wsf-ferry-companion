// Terminal dot + tracked-caps label markers, side-aware so a label
// extends over water rather than inland.
//
// The list comes from the terminals dim, not a hardcoded table. The
// original six anchors were the M1 prototype's central-Sound framing, and
// they left Clinton and Mukilteo unlabeled in the DEFAULT phone view with
// a ferry sitting at Clinton - boats with nowhere to be going.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import type { TerminalDim } from "@/lib/data/dims";

export interface LabelHint {
  /** Label sits LEFT of the dot (the terminal is on the water's east shore). */
  side?: "right";
  /** Dimmer treatment: not a place a rider boards. */
  soft?: boolean;
  /** Shorter label where the dim's official name crowds the map. */
  label?: string;
  /** Names itself only once zoomed in - see LABEL_ALL_ZOOM. */
  minor?: boolean;
}

/** Per-terminal placement, keyed by TerminalID. Anything absent takes the
 *  default (label to the right of the dot). Sides are set from where the
 *  water actually is and checked on screen, not guessed in bulk. */
export const LABEL_HINTS: Record<number, LabelHint> = {
  1: { label: "Anacortes", minor: true },
  3: { side: "right", label: "Bainbridge" },
  4: { side: "right" },
  5: { side: "right", label: "Clinton" },
  7: { side: "right", label: "Seattle" },
  8: { side: "right", label: "Edmonds" },
  9: { side: "right", label: "Fauntleroy", minor: true },
  10: { side: "right", label: "Friday Harbor", minor: true },
  11: { side: "right", label: "Coupeville", minor: true },
  12: { side: "right" },
  13: { label: "Lopez", minor: true },
  14: { side: "right", label: "Mukilteo" },
  15: { label: "Orcas", minor: true },
  16: { side: "right", label: "Pt. Defiance", minor: true },
  17: { side: "right", label: "Port Townsend", minor: true },
  18: { label: "Shaw", minor: true },
  20: { side: "right", label: "Southworth", minor: true },
  21: { label: "Tahlequah", minor: true },
  22: { side: "right", label: "Vashon", minor: true },
  122: { side: "right", label: "Eagle Harbor yard", soft: true, minor: true },
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
    el.className = [
      className,
      hint.soft ? "soft" : "",
      hint.side === "right" ? "right" : "",
      hint.minor ? "minor" : "",
    ]
      .filter(Boolean)
      .join(" ");
    el.innerHTML = `<i></i><span>${hint.label ?? term.name}</span>`;

    return new maplibregl.Marker({
      element: el,
      anchor: hint.side === "right" ? "right" : "left",
      offset: hint.side === "right" ? [-8, 0] : [8, 0],
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
