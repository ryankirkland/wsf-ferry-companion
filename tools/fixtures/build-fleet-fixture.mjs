// Derive dev/test fixtures from the checked-in API exploration samples:
// three fleet.json frames (~12 s apart, underway vessels advanced along
// their headings) + a vessels.json dim fixture. Deterministic - no RNG.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SAMPLES = path.join(ROOT, "api-exploration-wsdot-ferries/samples");
const OUT = path.join(ROOT, "web/public/dev-fixtures");

const rows = JSON.parse(await readFile(path.join(SAMPLES, "vessels_vessellocations.json"), "utf8"));
const verbose = JSON.parse(await readFile(path.join(SAMPLES, "vessels_vesselverbose.json"), "utf8"));

const parseDotnet = (s) => (s ? Number(s.match(/\/Date\((-?\d+)/)[1]) : null);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

// Anchor all frames to the sample's freshest stamp so ages are realistic.
const newest = Math.max(...rows.map((r) => parseDotnet(r.TimeStamp)));

function vesselAt(row, frame) {
  const tsMs = parseDotnet(row.TimeStamp);
  const ageS = Math.max(0, Math.round((newest + frame * 12_000 - tsMs) / 1000));
  const stale = ageS > 300;
  const yard = row.DepartingTerminalID === 122;
  const underway = !row.AtDock && !stale && !yard;

  // Advance underway vessels along their heading (knots -> deg, rough).
  let { Latitude: lat, Longitude: lon } = row;
  if (underway && frame > 0) {
    const dist = ((row.Speed * 0.514) / 111_000) * 12 * frame;
    lat += dist * Math.cos((row.Heading * Math.PI) / 180);
    lon += (dist * Math.sin((row.Heading * Math.PI) / 180)) / Math.cos((lat * Math.PI) / 180);
  }

  return {
    id: row.VesselID,
    name: row.VesselName,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    speed: row.Speed,
    heading: row.Heading,
    state: stale ? "stale" : yard ? "yard" : row.AtDock ? "docked" : "underway",
    insvc: row.InService,
    age_s: stale ? ageS : Math.min(ageS, 60),
    dep: row.DepartingTerminalID,
    arr: row.ArrivingTerminalID ?? null,
    left: row.LeftDock ? iso(parseDotnet(row.LeftDock)) : null,
    eta: row.Eta ? iso(parseDotnet(row.Eta)) : null,
    eta_basis: row.EtaBasis ?? null,
    sched: row.ScheduledDeparture ? iso(parseDotnet(row.ScheduledDeparture)) : null,
    routes: row.OpRouteAbbrev,
    pos: row.VesselPositionNum ?? null,
  };
}

await mkdir(OUT, { recursive: true });
for (const frame of [0, 1, 2]) {
  const snapshot = {
    v: 1,
    generated_at: iso(newest + frame * 12_000),
    vessels: rows.map((r) => vesselAt(r, frame)),
  };
  await writeFile(path.join(OUT, `fleet-frame-${frame}.json`), JSON.stringify(snapshot, null, 1));
}

const dims = {
  v: 1,
  vessels: verbose.map((r) => ({
    id: r.VesselID,
    name: r.VesselName,
    abbrev: r.VesselAbbrev,
    class: r.Class?.PublicDisplayName || r.Class?.ClassName || "",
    silhouette: r.Class?.SilhouetteImg || "",
    max_passengers: r.MaxPassengerCount,
    reg_deck_space: r.RegDeckSpace,
    tall_deck_space: r.TallDeckSpace,
    year_built: r.YearBuilt,
    year_rebuilt: r.YearRebuilt ?? null,
    length: r.Length,
  })),
};
await writeFile(path.join(OUT, "vessels.json"), JSON.stringify(dims, null, 1));
console.log(`fixtures: 3 fleet frames + ${dims.vessels.length} vessel dims -> ${OUT}`);
