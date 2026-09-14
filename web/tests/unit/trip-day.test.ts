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
    expect(view.ghosts).toHaveLength(0);
  });

  it("a matched cancel with no row becomes a certain ghost slot at its Sound-local instant", () => {
    const view = buildDayView(day([sailing(D)], [{ ...cancel, time_local: "09:59" }]));
    expect(view.cancelledMs.size).toBe(0);
    expect(view.rowNotes.size).toBe(0);
    expect(view.ghosts).toHaveLength(1);
    expect(view.ghosts[0]).toMatchObject({
      time_local: "09:59",
      depart_ms: Date.parse("2026-01-15T17:59:00Z"),
      reason: "tidal cancellation",
      tidal: true,
      certain: true,
    });
  });

  it("an unmatched cancel (multi-terminal route) never strikes: it notes the same-time row", () => {
    // The 14:05 boat is still published, and the cancel may be another
    // destination's - the row stays live and carries the doubt.
    const view = buildDayView(day([sailing(D)], [{ ...cancel, time_local: "14:05", matched: false }]));
    expect(view.cancelledMs.size).toBe(0);
    expect(view.ghosts).toHaveLength(0);
    expect(view.rowNotes.get(D)).toBe(
      "WSF lists a 14:05 tidal cancellation from this terminal - it may be this sailing",
    );
  });

  it("an unmatched cancel with no row is a hedged ghost", () => {
    const view = buildDayView(day([sailing(D)], [{ ...cancel, time_local: "09:59", matched: false }]));
    expect(view.ghosts).toHaveLength(1);
    expect(view.ghosts[0]).toMatchObject({ time_local: "09:59", certain: false });
  });

  it("ghosts sort by slot", () => {
    const view = buildDayView(
      day([sailing(D)], [
        { ...cancel, time_local: "16:00" },
        { ...cancel, time_local: "09:59" },
      ]),
    );
    expect(view.ghosts.map((g) => g.time_local)).toEqual(["09:59", "16:00"]);
  });

  it("a pre-03:00 cancel names the service day's post-midnight morning", () => {
    const view = buildDayView(day([sailing(D)], [{ ...cancel, time_local: "00:30" }]));
    expect(view.ghosts[0]!.depart_ms).toBe(Date.parse("2026-01-16T08:30:00Z"));
  });

  it("yesterday's file contributes only its post-midnight tail, on both branches", () => {
    const yesterday = {
      ...day([], [
        { ...cancel, time_local: "14:05" }, // yesterday's 2:05 PM: must NOT strike today's 2:05 PM
        { ...cancel, time_local: "00:30" }, // this morning: shown
      ]),
      service_date: "2026-01-14",
    };
    const today = day([sailing(D)], [{ ...cancel, time_local: "00:30" }]);
    const view = buildDayView(today, yesterday);
    expect(view.cancelledMs.size).toBe(0);
    // Each file's 00:30 names its OWN morning: two distinct slots.
    expect(view.ghosts.map((g) => new Date(g.depart_ms).toISOString())).toEqual([
      "2026-01-15T08:30:00.000Z",
      "2026-01-16T08:30:00.000Z",
    ]);
  });

  it("the same slot named twice renders once", () => {
    const today = day([sailing(D)], [
      { ...cancel, time_local: "09:59" },
      { ...cancel, time_local: "09:59", tidal: false },
    ]);
    expect(buildDayView(today).ghosts.filter((g) => g.time_local === "09:59")).toHaveLength(1);
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
