// Own-layer setup: terrarium hillshade under the water, paper grain over
// paint under labels, dotted route lines. Insertion anchors are discovered
// from the live style, exactly as the prototype proved out.

import type { Feature } from "geojson";
import type { Map as MLMap } from "maplibre-gl";
import { GRAIN_BAKES } from "./grain";
import { routesGeoJSON } from "./routes-geo";

const WORLD: Feature = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-179, -85],
        [179, -85],
        [179, 85],
        [-179, 85],
        [-179, -85],
      ],
    ],
  },
};

export function setupLayers(map: MLMap): void {
  const layers = map.getStyle().layers;
  const waterLayer = layers.find(
    (l) => l.type === "fill" && /water/.test(l.id) && !/way/.test(l.id),
  );
  const firstSymbolId = layers.find((l) => l.type === "symbol")?.id;

  // Grain: two bakes registered once; recolor() flips the fill-pattern.
  for (const [name, bake] of Object.entries(GRAIN_BAKES)) {
    if (!map.hasImage(name)) map.addImage(name, bake());
  }
  map.addSource("ps-world", { type: "geojson", data: WORLD });
  map.addLayer(
    {
      id: "ps-grain",
      type: "fill",
      source: "ps-world",
      paint: { "fill-pattern": "grain-dark", "fill-opacity": 0.55 },
    },
    firstSymbolId,
  );

  // Hillshade under the water fill - mountains read beneath the Sound.
  map.addSource("ps-dem", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 13,
    attribution: "Terrain: Mapzen via AWS Open Data",
  });
  map.addLayer(
    {
      id: "ps-hillshade",
      type: "hillshade",
      source: "ps-dem",
      paint: { "hillshade-exaggeration": 0.28 },
    },
    waterLayer?.id,
  );

  // Dotted ink route lines - texture, not information.
  map.addSource("wsf-routes", { type: "geojson", data: routesGeoJSON() });
  map.addLayer({
    id: "wsf-routes",
    type: "line",
    source: "wsf-routes",
    layout: { "line-cap": "round" },
    paint: {
      "line-color": "#26333a",
      "line-width": 2,
      "line-opacity": 0.45,
      "line-dasharray": [0.1, 2.6],
    },
  });
}
