// Mirror the three Noto fontstacks positron uses from OpenFreeMap into
// ./mirror/fonts/ (then synced to the map-assets bucket - see MANIFEST.md).
// One-time per provider change; ADR-0003 makes self-hosted glyphs a day-one
// contract. Missing ranges 404 upstream and are skipped (logged).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://tiles.openfreemap.org/fonts";
const STACKS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];
const OUT = path.join(import.meta.dirname, "mirror", "fonts");
const CONCURRENCY = 16;

const ranges = Array.from({ length: 256 }, (_, i) => `${i * 256}-${i * 256 + 255}`);
const jobs = STACKS.flatMap((stack) => ranges.map((range) => ({ stack, range })));

let done = 0;
let skipped = 0;

async function fetchOne({ stack, range }) {
  const url = `${BASE}/${encodeURIComponent(stack)}/${range}.pbf`;
  const res = await fetch(url);
  if (!res.ok) {
    skipped++;
    if (res.status !== 404) console.warn(`SKIP ${stack}/${range}: HTTP ${res.status}`);
    return;
  }
  const dir = path.join(OUT, stack);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${range}.pbf`), Buffer.from(await res.arrayBuffer()));
  done++;
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await fetchOne(queue.pop());
  }),
);
console.log(`glyphs: ${done} mirrored, ${skipped} skipped (of ${jobs.length})`);
