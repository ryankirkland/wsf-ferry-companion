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
   *  at far zoom: slides the name+chip sideways while the dot stays on
   *  the coordinate (far zoom only - centered when close). */
  stagger?: "left" | "right";
  /** Hangs the whole stack under the dot at every zoom. Composes with
   *  stagger: below-left and below-right stacks can sit shoulder to
   *  shoulder where two above-stacks could not. */
  below?: boolean;
  /** Name at every zoom, weather chip only past the declutter zoom.
   *  For dense clusters (the San Juans above all): three names can be
   *  staggered into a 25px blob at the zoom floor; three chips cannot.
   *  Safe because none of these sit in the DEFAULT phone framing - the
   *  trap that sank the triangle's chip-hiding compromise. */
  chipLate?: boolean;
}

/** Per-terminal treatment, keyed by TerminalID. Markers stack
 *  vertically - weather chip over name over dot (owner's call,
 *  2026-08-19: the old sideways rows sprawled across the water and
 *  hid the boats), so shore side no longer matters. */
export const LABEL_HINTS: Record<number, LabelHint> = {
  // Owner's 2026-08-20 call, second round: EVERY rider port names itself
  // at full zoom-out - first the Fauntleroy triangle, then the whole
  // northern network (Anacortes, the San Juans, Coupeville, Port
  // Townsend) and the Tacoma pair. `minor` now covers only the yard.
  1: { label: "Anacortes", chipLate: true },
  3: { label: "Bainbridge" },
  4: { },
  5: { label: "Clinton" },
  7: { label: "Seattle" },
  8: { label: "Edmonds" },
  9: { label: "Fauntleroy", stagger: "right" },
  // The San Juans at the zoom floor: Orcas/Shaw/Lopez dots sit within
  // ~10px of each other. Orcas holds the row above, Shaw hangs
  // below-right, Lopez below-left, Friday Harbor slides west - each
  // label over its own island or open water.
  10: { label: "Friday Harbor", stagger: "left", chipLate: true },
  11: { label: "Coupeville", chipLate: true },
  12: { },
  13: { label: "Lopez", stagger: "left", below: true, chipLate: true },
  14: { label: "Mukilteo" },
  15: { label: "Orcas", chipLate: true },
  // Tacoma pair: same column, 7px apart at the floor - Tahlequah keeps
  // the row above (south tip of Vashon), Pt. Defiance hangs below.
  16: { label: "Pt. Defiance", below: true, chipLate: true },
  17: { label: "Port Townsend", below: true, chipLate: true },
  18: { label: "Shaw", stagger: "right", below: true, chipLate: true },
  20: { label: "Southworth", stagger: "left", below: true },
  21: { label: "Tahlequah", chipLate: true },
  22: { label: "Vashon", stagger: "right", below: true },
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
      hint.below ? "stag-below" : "",
      hint.chipLate ? "chip-late" : "",
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

    const below = hint.below === true;
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
  // White Center rides with Fauntleroy, Burien with Vashon: their
  // basemap texts sit exactly where those right-staggered labels land
  // at far zoom.
  const extras = [
    "Bainbridge Island",
    "Vashon",
    "Friday Harbor",
    "Port Townsend",
    "White Center",
    "Burien",
  ];
  return [...new Set([...terminals.map((t) => t.name), ...extras])];
}
