// Mirror positron's sprite set (ofm_f384) into ./mirror/sprites/.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://tiles.openfreemap.org/sprites/ofm_f384";
const FILES = ["ofm.json", "ofm.png", "ofm@2x.json", "ofm@2x.png"];
const OUT = path.join(import.meta.dirname, "mirror", "sprites", "ofm_f384");

await mkdir(OUT, { recursive: true });
for (const file of FILES) {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await writeFile(path.join(OUT, file), Buffer.from(await res.arrayBuffer()));
  console.log(`sprite: ${file}`);
}
