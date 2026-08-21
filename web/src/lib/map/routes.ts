// The route filter's taxonomy and persistence (owner's ask, 2026-08-20:
// "I care mostly about where Bremerton and Southworth routes are - the
// others become noise").
//
// Keyed by the vessel feed's OpRouteAbbrev strings - the stable join
// key every boat already carries (verified against live fleet.json:
// exactly these eight). Terminal membership is curated here rather than
// derived from the pairs index at runtime: the network changes on the
// order of decades, and a wrong derivation would silently hide boats. A
// unit test pins every fixture/live abbrev to this table so a new route
// shows up as a test failure, never as an invisibly-unfiltered boat.

import { HIDDEN_ROUTES_KEY, HIDE_OOS_KEY, readStorage, writeStorage } from "@/lib/storage";

export interface RouteDef {
  abbrev: string;
  label: string;
  /** TerminalIDs this route serves - drives terminal-marker hiding. */
  terminals: number[];
}

export const ROUTES: RouteDef[] = [
  { abbrev: "sea-bi", label: "Seattle - Bainbridge", terminals: [7, 3] },
  { abbrev: "sea-br", label: "Seattle - Bremerton", terminals: [7, 4] },
  { abbrev: "ed-king", label: "Edmonds - Kingston", terminals: [8, 12] },
  { abbrev: "muk-cl", label: "Mukilteo - Clinton", terminals: [14, 5] },
  { abbrev: "f-v-s", label: "Fauntleroy - Vashon - Southworth", terminals: [9, 22, 20] },
  { abbrev: "pt-cou", label: "Port Townsend - Coupeville", terminals: [17, 11] },
  { abbrev: "pd-tal", label: "Pt. Defiance - Tahlequah", terminals: [16, 21] },
  { abbrev: "ana-sj", label: "Anacortes - San Juans", terminals: [1, 10, 13, 15, 18] },
];

/** A vessel hides only when it names routes and EVERY one is hidden -
 *  a boat we cannot classify (yard moves, repositioning: routes []) is
 *  never hidden. Honesty rule: filtering trims noise, it must not make
 *  real boats vanish unaccountably. */
export function vesselHidden(routes: string[], hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0 || routes.length === 0) return false;
  return routes.every((r) => hidden.has(r));
}

/** A terminal hides only when it belongs to this taxonomy and every
 *  route serving it is hidden. Unknown terminals (the yard) never hide. */
export function terminalHidden(terminalId: number, hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0) return false;
  const serving = ROUTES.filter((r) => r.terminals.includes(terminalId));
  if (serving.length === 0) return false;
  return serving.every((r) => hidden.has(r.abbrev));
}

/** Stored preference: the HIDDEN set (empty = everything visible, which
 *  is also what a missing/corrupt value degrades to). Per-device via
 *  localStorage; account-level sync is a candidate follow-up. */
export function readHiddenRoutes(): Set<string> {
  try {
    const raw = readStorage(HIDDEN_ROUTES_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    const known = new Set(ROUTES.map((r) => r.abbrev));
    return new Set(arr.filter((a): a is string => typeof a === "string" && known.has(a)));
  } catch {
    return new Set();
  }
}

export function writeHiddenRoutes(hidden: ReadonlySet<string>): void {
  writeStorage(HIDDEN_ROUTES_KEY, JSON.stringify([...hidden]));
}

/** Out-of-service toggle (owner's follow-up, 2026-08-21: tied-up boats
 *  are dock clutter). Out-of-service = the feed's insvc flag, false -
 *  which also covers yard boats. These report no routes, so the route
 *  checkboxes can never reach them; this is their own switch. Default
 *  is SHOWN (missing/corrupt value degrades to showing boats). */
export function readHideOutOfService(): boolean {
  return readStorage(HIDE_OOS_KEY) === "1";
}

export function writeHideOutOfService(hide: boolean): void {
  writeStorage(HIDE_OOS_KEY, hide ? "1" : "0");
}
