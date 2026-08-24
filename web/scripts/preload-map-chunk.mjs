// Post-build: tell the browser about the map chunk during HTML parse.
//
// WHY THIS EXISTS. `/` and `/ambient` load maplibre-gl (~350 KB gz) through
// next/dynamic, which is right - a static import blocks hydration of the
// page's only nav control on a 1.26 MB parse. But the chunk's URL then
// lives inside JavaScript, so the browser cannot discover it until the page
// bundle has downloaded, parsed, and started running. Measured on a
// throttled phone (2026-08-23): the request went out at ~2,000 ms and the
// first ferry appeared at ~12 s. /ambient, which imports the map
// statically, requested it at ~300 ms and reached first-boat a full second
// sooner despite shipping more code. The cost was never the bytes - it was
// discovering them late.
//
// A <link rel="preload" as="script"> in the head gets the download started
// during HTML parse while React hydrates in parallel, so we keep the
// dynamic import's hydration benefit and drop its discovery penalty.
//
// `as="script"` (not modulepreload): webpack/turbopack fetch these chunks as
// classic scripts, and a modulepreload would warm the wrong cache and log a
// console warning about an unused preload.
//
// This asserts rather than degrades: a silent no-op here would look exactly
// like success while quietly costing every mobile visitor a second and a
// half, which is the failure mode this project has been bitten by before.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("out");
const CHUNK_DIR = path.join(OUT, "_next", "static", "chunks");
// Pages that mount a map. Both use next/dynamic; both want the hint.
const PAGES = ["index.html", path.join("ambient", "index.html")];
// A string that appears in maplibre-gl and essentially nothing else.
const MAPLIBRE_MARKER = "maplibregl";

function findMapChunk() {
  const candidates = readdirSync(CHUNK_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ f, size: readFileSync(path.join(CHUNK_DIR, f)).length }))
    .sort((a, b) => b.size - a.size);

  for (const { f } of candidates.slice(0, 5)) {
    if (readFileSync(path.join(CHUNK_DIR, f), "utf8").includes(MAPLIBRE_MARKER)) return f;
  }
  return null;
}

const chunk = findMapChunk();
if (!chunk) {
  console.error(
    `preload-map-chunk: no chunk in ${CHUNK_DIR} contains "${MAPLIBRE_MARKER}".\n` +
      "The map bundle moved or the marker changed - fix this script rather than " +
      "shipping without the hint, which silently costs ~1.5s to first boat on mobile.",
  );
  process.exit(1);
}

const link = `<link rel="preload" as="script" href="/_next/static/chunks/${chunk}"/>`;
let patched = 0;
for (const page of PAGES) {
  const file = path.join(OUT, page);
  let html;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    console.error(`preload-map-chunk: expected ${page} in the export and it is missing.`);
    process.exit(1);
  }
  if (html.includes(link)) continue;
  if (!html.includes("</head>")) {
    console.error(`preload-map-chunk: ${page} has no </head> to inject into.`);
    process.exit(1);
  }
  writeFileSync(file, html.replace("</head>", `${link}</head>`));
  patched += 1;
}

console.log(`preload-map-chunk: hinted ${chunk} in ${patched} page(s)`);
