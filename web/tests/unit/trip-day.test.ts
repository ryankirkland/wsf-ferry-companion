// Day-view assembly: post-midnight merge, cancel matching, and the fixture
// template resolver's depart/depart_ms invariant (the live builder enforces
// the same invariant server-side; this keeps fixtures equally honest).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDayView, mergeDays } from "@/lib/trip/day";
import { resolveTripTemplate } from "@/lib/trip/fixture-template";
import { isPairDay, type PairDay, type Sailing } from "@/lib/trip/types";

const MIN = 60_000;
// 2:05 PM PST - matched by the "14:05" cancel adjustment below.
const D = Date.parse("2026-01-15T22:05:00Z");

function sailing(ms: number, vesselId = 37, afterMidnight = false): Sailing {
  return {
    depart: new Date(ms).toISOString(),
    depart_ms: ms,
    vessel_id: vesselId,
    vessel: "Wenatchee",
    pos_num: 1,
    accessible: true,
    loading_rule: 3,
    after_midnight: afterMidnight,
    added: false,
    notes: [],
  };
}

function day(sailings: Sailing[], adjustments: PairDay["adjustments"] = []): PairDay {
  return {
    v: 1,
    generated_at: "2026-01-15T00:00:00Z",
    pair: { dep: 7, arr: 3 },
    service_date: "2026-01-15",
    schedule_id: 196,
    crossing_min: 35,
    sailings,
    adjustments,
  };
}

describe("mergeDays", () => {
  it("prepends yesterday's after-midnight tail, dedups, sorts", () => {
    const tail = sailing(D - 60 * MIN, 32, true);
    const dup = sailing(D, 37, true);
    const yesterday = day([sailing(D - 600 * MIN, 32), tail, dup]);
    const today = day([sailing(D), sailing(D + 60 * MIN, 32)]);
    const merged = mergeDays(today, yesterday);
    expect(merged.map((s) => s.depart_ms)).toEqual([D - 60 * MIN, D, D + 60 * MIN]);
  });

  it("works without a yesterday file", () => {
    expect(mergeDays(day([sailing(D)]), null)).toHaveLength(1);
  });
});

describe("buildDayView adjustments", () => {
  const cancel = { type: "cancel" as const, terminal_id: 7, tidal: true, matched: true };

  it("strikes the row whose Sound-local time matches a matched cancel", () => {
    const view = buildDayView(day([sailing(D), sailing(D + 90 * MIN)], [{ ...cancel, time_local: "14:05" }]));
    expect(view.cancelledMs.has(D)).toBe(true);
    expect(view.cancelReason.get(D)).toBe("tidal cancellation");
    expect(view.dayNotes).toHaveLength(0);
  });

  it("unmatched or unpinnable cancels become day-level notes", () => {
    const view = buildDayView(
      day([sailing(D)], [
        { ...cancel, time_local: "14:05", matched: false },
        { ...cancel, time_local: "09:59" },
      ]),
    );
    expect(view.cancelledMs.size).toBe(0);
    expect(view.dayNotes).toHaveLength(2);
  });

  it("additions never strike rows", () => {
    const view = buildDayView(day([sailing(D)], [{ type: "add", time_local: "14:05", terminal_id: 7, tidal: true, matched: true }]));
    expect(view.cancelledMs.size).toBe(0);
  });
});

describe("fixture template", () => {
  const raw = readFileSync(
    path.resolve(import.meta.dirname, "../../public/dev-fixtures/pair-day.template.json"),
    "utf8",
  );

  it("resolves to a valid PairDay holding the depart/depart_ms invariant", () => {
    const doc: unknown = JSON.parse(resolveTripTemplate(raw, D));
    expect(isPairDay(doc)).toBe(true);
    const dayDoc = doc as PairDay;
    expect(dayDoc.sailings.length).toBeGreaterThanOrEqual(6);
    for (const s of dayDoc.sailings) {
      expect(Date.parse(s.depart)).toBe(s.depart_ms);
    }
    expect(dayDoc.service_date).toBe("2026-01-15");
    // Offsets straddle "now" so every signal band is exercisable.
    expect(dayDoc.sailings.some((s) => s.depart_ms < D)).toBe(true);
    expect(dayDoc.sailings.some((s) => s.depart_ms > D + 26 * MIN)).toBe(true);
  });
});
