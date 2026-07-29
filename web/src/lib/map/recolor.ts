// Runtime restyle of the (forked) positron style - the Paper Sound look.
// The id-substring heuristics were verified against the live style
// 2026-07-28; the fork keeps layers structurally identical so they stay
// valid. Every setPaintProperty sits in its own try/catch because some
// layers reject some props - by design, not sloppiness.

import type { Map as MLMap } from "maplibre-gl";
import type { MapPalette } from "./palettes";

// Basemap towns suppressed under our own terminal markers. The basemap
// spells the island in full.
const SUPPRESSED_TOWNS = ["Seattle", "Bremerton", "Edmonds", "Kingston", "Bainbridge Island"];

const GREEN_RE = /(wood|grass|park|landcover|cemetery|golf|garden)/;
const LANDUSE_RE = /(residential|landuse|sand|school|hospital|industrial|commercial)/;
const ROAD_MAJOR_RE = /(motorway|trunk|primary|major)/;
const ROAD_RE = /(road|street|highway|minor|service|path|track|tunnel|bridge|rail|transit|ferry|aeroway)/;
const ROAD_HIDE_RE = /(path|track|rail|transit|ferry|aeroway)/;
const SYMBOL_HIDE_RE = /(poi|housenum|transit|shield|route|road|highway|airport|aerodrome)/;

function trySet(fn: () => void): void {
  try {
    fn();
  } catch {
    /* some layers reject some props */
  }
}

function styleLayers(map: MLMap) {
  try {
    return map.getStyle()?.layers;
  } catch {
    return undefined;
  }
}

export function recolor(map: MLMap, pal: MapPalette): void {
  const layers = styleLayers(map);
  if (!layers?.length) return;

  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    const setPaint = (prop: string, value: unknown) =>
      trySet(() => map.setPaintProperty(layer.id, prop, value));
    const hide = () => trySet(() => map.setLayoutProperty(layer.id, "visibility", "none"));

    switch (layer.type) {
      case "background":
        setPaint("background-color", pal.land);
        break;
      case "fill":
        if (id.includes("water")) {
          setPaint("fill-color", pal.water);
          setPaint("fill-outline-color", pal.water);
        } else if (GREEN_RE.test(id)) {
          setPaint("fill-color", pal.green);
        } else if (LANDUSE_RE.test(id)) {
          setPaint("fill-color", pal.land);
        } else if (id.includes("building")) {
          hide();
        }
        break;
      case "line":
        if (id.includes("waterway")) {
          setPaint("line-color", pal.waterway);
        } else if (ROAD_MAJOR_RE.test(id)) {
          setPaint("line-color", pal.roadMajor);
        } else if (ROAD_RE.test(id)) {
          if (ROAD_HIDE_RE.test(id)) hide();
          else setPaint("line-color", pal.road);
        } else if (id.includes("boundary")) {
          setPaint("line-color", pal.boundary);
          setPaint("line-dasharray", [2, 3]);
        }
        break;
      case "symbol":
        if (SYMBOL_HIDE_RE.test(id)) {
          hide();
        } else if (id.includes("water")) {
          setPaint("text-color", pal.waterText);
          setPaint("text-halo-color", pal.halo);
        } else {
          setPaint("text-color", pal.text);
          setPaint("text-halo-color", pal.halo);
          setPaint("text-halo-width", 1.4);
        }
        break;
    }
  }

  // Our own layers re-tint with the palette.
  trySet(() => map.setPaintProperty("wsf-routes", "line-color", pal.text));
  trySet(() => {
    map.setPaintProperty("ps-hillshade", "hillshade-shadow-color", pal.hillShadow);
    map.setPaintProperty("ps-hillshade", "hillshade-highlight-color", pal.hillLight);
    map.setPaintProperty("ps-hillshade", "hillshade-exaggeration", pal.hillAmt);
  });
  trySet(() => map.setPaintProperty("ps-grain", "fill-pattern", pal.grain));
}

/** Suppress basemap labels for our five terminal towns. The prototype
 * tested /place/ against layer IDS - a silent no-op, since positron names
 * them label_city/label_town with source-layer "place". Returns how many
 * layers matched so callers can assert the fork didn't break this. */
export function dedupePlaceLabels(map: MLMap): number {
  const layers = styleLayers(map);
  if (!layers) return 0;

  const notOurs = [
    "!",
    ["in", ["coalesce", ["get", "name:latin"], ["get", "name"]], ["literal", SUPPRESSED_TOWNS]],
  ];
  let matched = 0;
  for (const layer of layers) {
    if (layer.type !== "symbol") continue;
    if (!("source-layer" in layer) || layer["source-layer"] !== "place") continue;
    matched++;
    trySet(() => {
      const existing = map.getFilter(layer.id);
      map.setFilter(
        layer.id,
        (existing ? ["all", existing, notOurs] : notOurs) as Parameters<typeof map.setFilter>[1],
      );
    });
  }
  return matched;
}
