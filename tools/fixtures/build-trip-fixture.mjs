// Trip fixtures from LIVE production data (the backend shipped first):
// pairs-index verbatim, one pair-day re-timed so signal states are
// exercisable in dev/tests, fares verbatim, alerts synthetic.
// Deterministic re-timing: sailings placed relative to a BASE_MS injected
// at load by the fixture consumer (placeholders "%%BASE+N%%" for minutes).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "../../web/public/dev-fixtures");
const get = async (p) => (await fetch(`https://ferrysound.com${p}`)).json();

await mkdir(OUT, { recursive: true });

const index = await get("/data/pairs/index.json");
await writeFile(path.join(OUT, "pairs-index.json"), JSON.stringify(index, null, 1));

// Re-timed day: offsets in minutes from "now" chosen to show every signal.
const OFFSETS = [-95, -40, -8, 6, 18, 55, 130, 210];
const day = await get(`/data/pairs/7-3/${index.horizon.from}.json`);
const base = day.sailings.slice(0, OFFSETS.length);
day.sailings = base.map((s, i) => ({
  ...s,
  depart: `%%ISO${OFFSETS[i]}%%`,
  depart_ms: `%%MS${OFFSETS[i]}%%`,
}));
day.service_date = "%%TODAY%%";
day.adjustments = [{ type: "cancel", time_local: "14:05", terminal_id: 7, tidal: true, matched: true }];
await writeFile(path.join(OUT, "pair-day.template.json"), JSON.stringify(day, null, 1));

const fares = await get("/data/fares/14-5.json");
await writeFile(path.join(OUT, "fares-14-5.json"), JSON.stringify(fares, null, 1));

await writeFile(
  path.join(OUT, "alerts.json"),
  JSON.stringify(
    {
      v: 1, generated_at: "%%NOW%%", watermark: "999:0",
      alerts: [{ id: 999, title: "Seattle / Bainbridge - sample service notice",
        text: "This is a fixture alert for development.", published: "%%NOW%%",
        route_ids: [5], all_routes: false }],
    }, null, 1),
);

// The slug map source of truth for web/src/lib/trip/pairs.ts:
const bySlug = Object.fromEntries(index.pairs.map(p => [p.slug, p]));
const entries = index.pairs.map(p => {
  const mate = index.pairs.find(q => q.dep === p.arr && q.arr === p.dep);
  return `  "${p.slug}": { dep: ${p.dep}, arr: ${p.arr}, depName: ${JSON.stringify(p.dep_name)}, arrName: ${JSON.stringify(p.arr_name)}, mate: ${JSON.stringify(mate?.slug ?? null)} },`;
}).join("\n");
const ts = `// GENERATED from live /data/pairs/index.json by tools/fixtures/build-trip-fixture.mjs
// (a vitest drift check compares this against the pairs-index fixture).

export interface PairEntry {
  dep: number;
  arr: number;
  depName: string;
  arrName: string;
  mate: string | null;
}

export const PAIRS: Record<string, PairEntry> = {
${entries}
};
`;
await mkdir(path.join(import.meta.dirname, "../../web/src/lib/trip"), { recursive: true });
await writeFile(path.join(import.meta.dirname, "../../web/src/lib/trip/pairs.ts"), ts);
console.log("fixtures + pairs.ts:", index.pairs.length, "pairs");
