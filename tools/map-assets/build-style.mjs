// Fork positron for self-hosting (ADR-0003): rewrite glyphs/sprite to
// ferrysound.com, drop the unused ne2_shaded raster source, keep everything
// else BYTE-IDENTICAL in structure - the recolor heuristics in
// web/src/lib/map/recolor.ts depend on positron's layer ids.
//
// Usage: node build-style.mjs [--selfhost]
//   default  -> dist/positron-v1.json          (OpenFreeMap vector tiles)
//   selfhost -> dist/positron-selfhost-v1.json (PMTiles fallback, /tiles/*)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SELFHOST = process.argv.includes("--selfhost");
const HOST = "https://ferrysound.com";

const res = await fetch("https://tiles.openfreemap.org/styles/positron");
if (!res.ok) throw new Error(`positron fetch: HTTP ${res.status}`);
const style = await res.json();

style.glyphs = `${HOST}/assets/fonts/{fontstack}/{range}.pbf`;
style.sprite = `${HOST}/assets/sprites/ofm_f384/ofm`;

// Declared by positron but referenced by no layer - verified 2026-07-28.
delete style.sources.ne2_shaded;
style.layers = style.layers.filter((l) => l.source !== "ne2_shaded");

if (SELFHOST) {
  const vectorName = Object.keys(style.sources).find((s) => style.sources[s].type === "vector");
  style.sources[vectorName] = {
    type: "vector",
    tiles: [`${HOST}/tiles/wa/{z}/{x}/{y}.mvt`],
    maxzoom: 14,
    attribution: style.sources[vectorName].attribution ?? "© OpenStreetMap contributors",
  };
}

const out = path.join(
  import.meta.dirname,
  "dist",
  SELFHOST ? "positron-selfhost-v1.json" : "positron-v1.json",
);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(style, null, 1) + "\n");
console.log(`${out}: ${style.layers.length} layers, sources: ${Object.keys(style.sources)}`);
