// Resolves the placeholder grammar in dev-fixtures/pair-day.template.json:
//   "%%MS<n>%%"  -> baseMs + n minutes, as a JSON number (quotes consumed)
//   %%ISO<n>%%   -> ISO instant of baseMs + n minutes (stays a string)
//   %%TODAY%%    -> Sound-local YYYY-MM-DD of baseMs
//   %%NOW%%      -> ISO instant of baseMs
// Offsets are minutes relative to "now", so the fixture always exercises
// departed/boarding/tight/comfortable at once, deterministically in tests
// (fixed baseMs) and believably in dev (baseMs = load time).

import { soundDate } from "@/lib/time/sound-time";

const MIN = 60_000;

let captured: number | null = null;

/** The clock every fixture document is re-timed against, captured once per
 * page load. The trip day, the alerts and the capacity readings all join on
 * depart_ms; calling Date.now() separately in each fetcher put them
 * milliseconds apart and no reading ever matched a sailing. */
export function fixtureBaseMs(): number {
  captured ??= Date.now();
  return captured;
}

export function resolveTripTemplate(rawJson: string, baseMs: number): string {
  return rawJson
    .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(baseMs + Number(n) * MIN))
    .replace(/%%ISO(-?\d+)%%/g, (_, n) => new Date(baseMs + Number(n) * MIN).toISOString())
    .replace(/%%TODAY%%/g, soundDate(new Date(baseMs)))
    .replace(/%%NOW%%/g, new Date(baseMs).toISOString());
}
