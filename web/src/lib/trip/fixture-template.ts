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

export function resolveTripTemplate(rawJson: string, baseMs: number): string {
  return rawJson
    .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(baseMs + Number(n) * MIN))
    .replace(/%%ISO(-?\d+)%%/g, (_, n) => new Date(baseMs + Number(n) * MIN).toISOString())
    .replace(/%%TODAY%%/g, soundDate(new Date(baseMs)))
    .replace(/%%NOW%%/g, new Date(baseMs).toISOString());
}
