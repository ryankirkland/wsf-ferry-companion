// Route polylines and terminal anchor points in lon/lat, proven in the
// design prototype (Bremerton bends through Rich Passage). Route lines are
// texture, not information - dotted at 45% opacity.

import type { FeatureCollection } from "geojson";

export type LngLat = [number, number];

export const GEO_ROUTES: Record<string, LngLat[]> = {
  sea_bi: [
    [-122.3396, 47.6023],
    [-122.411, 47.6125],
    [-122.47, 47.62],
    [-122.5111, 47.6231],
  ],
  sea_br: [
    [-122.3396, 47.6023],
    [-122.438, 47.585],
    [-122.485, 47.577],
    [-122.528, 47.5788],
    [-122.546, 47.586],
    [-122.578, 47.5865],
    [-122.606, 47.572],
    [-122.625, 47.562],
  ],
  ed_king: [
    [-122.385, 47.813],
    [-122.43, 47.8065],
    [-122.4977, 47.7962],
  ],
};

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

export function routesGeoJSON(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Object.entries(GEO_ROUTES).map(([id, coords]) => ({
      type: "Feature",
      properties: { id },
      geometry: { type: "LineString", coordinates: coords },
    })),
  };
}
