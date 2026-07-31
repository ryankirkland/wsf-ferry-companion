// Which terminals WSF actually sails to right now, straight from the live
// pairs index. Used so the map draws today's network rather than the
// terminal dim's full history - the dim still carries Sidney B.C., whose
// route ended in 2019.

import { DATA_BASE, DATA_MODE, PAIRS_INDEX_PATH } from "@/config";
import { isPairsIndex } from "@/lib/trip/types";

let cache: Set<number> | null = null;

export async function servedTerminalIds(): Promise<Set<number>> {
  if (cache) return cache;
  const url =
    DATA_MODE === "fixture" ? "/dev-fixtures/pairs-index.json" : DATA_BASE + PAIRS_INDEX_PATH;
  try {
    const doc: unknown = await (await fetch(url, { cache: "no-store" })).json();
    if (!isPairsIndex(doc)) return new Set();
    cache = new Set(doc.pairs.flatMap((p) => [p.dep, p.arr]));
    return cache;
  } catch {
    // No index, no filter: better a complete map than a blank one.
    return new Set();
  }
}
