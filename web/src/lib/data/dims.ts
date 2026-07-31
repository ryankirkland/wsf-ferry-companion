// Fetch-once caches for the rarely-changing dimension JSON. In fixture mode
// the same files are served from /dev-fixtures/.

import { DATA_BASE, DATA_MODE, DIMS_PATH, TERMINALS_PATH } from "@/config";

export interface VesselDim {
  id: number;
  name: string;
  abbrev: string;
  class: string;
  /** Mirrored WSDOT class drawing, e.g. /assets/vessels/jumbo-mark-ii.png. */
  drawing: string | null;
  silhouette: string;
  max_passengers: number;
  reg_deck_space: number;
  tall_deck_space: number;
  year_built: number;
  year_rebuilt: number | null;
  length: string;
}

export interface TerminalDim {
  id: number;
  name: string;
  abbrev: string;
  lat: number;
  lon: number;
  synthetic: boolean;
}

let vesselCache: Map<number, VesselDim> | null = null;
let terminalCache: Map<number, TerminalDim> | null = null;

function url(livePath: string, fixtureName: string): string {
  return DATA_MODE === "fixture" ? `/dev-fixtures/${fixtureName}` : `${DATA_BASE}${livePath}`;
}

export async function getVesselDims(): Promise<Map<number, VesselDim>> {
  if (!vesselCache) {
    const res = await fetch(url(DIMS_PATH, "vessels.json"));
    if (!res.ok) throw new Error(`vessels dims: HTTP ${res.status}`);
    const body = (await res.json()) as { vessels: VesselDim[] };
    vesselCache = new Map(body.vessels.map((v) => [v.id, v]));
  }
  return vesselCache;
}

export async function getTerminalDims(): Promise<Map<number, TerminalDim>> {
  if (!terminalCache) {
    const res = await fetch(url(TERMINALS_PATH, "terminals.json"));
    if (!res.ok) throw new Error(`terminal dims: HTTP ${res.status}`);
    const body = (await res.json()) as { terminals: TerminalDim[] };
    terminalCache = new Map(body.terminals.map((t) => [t.id, t]));
  }
  return terminalCache;
}
