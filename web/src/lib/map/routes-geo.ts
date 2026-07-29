// Terminal anchor points in lon/lat, proven in the design prototype.
// (Route lines now come from OSM ferry geometry in the basemap tiles -
// see layers.ts; the hand-sketched polylines are gone for good reason.)

export type LngLat = [number, number];

export interface TerminalAnchor {
  ll: LngLat;
  label: string;
  side?: "right";
  soft?: boolean;
}

export const TERMS: Record<string, TerminalAnchor> = {
  seattle: { ll: [-122.3396, 47.6023], label: "Seattle" },
  bainbridge: { ll: [-122.5111, 47.6231], label: "Bainbridge", side: "right" },
  bremerton: { ll: [-122.625, 47.562], label: "Bremerton", side: "right" },
  edmonds: { ll: [-122.385, 47.813], label: "Edmonds" },
  kingston: { ll: [-122.4977, 47.7962], label: "Kingston", side: "right" },
  eagleHarbor: { ll: [-122.518, 47.62], label: "Eagle Harbor yard", soft: true, side: "right" },
};
