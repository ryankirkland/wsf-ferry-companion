// The signal state table - every state, every boundary. The engine is the
// product's core promise ("run for the 5:30 or relax?"), so this table is
// exhaustive on purpose.

import { describe, expect, it } from "vitest";
import { computeSignal, type SignalInput } from "@/lib/trip/signal";
import type { Sailing } from "@/lib/trip/types";
import type { VesselFix } from "@/lib/data/types";

const D = Date.parse("2026-01-15T22:05:00Z"); // 2:05 PM Sound time (PST)
const MIN = 60_000;

const sailing: Sailing = {
  depart: new Date(D).toISOString(),
  depart_ms: D,
  vessel_id: 37,
  vessel: "Wenatchee",
  pos_num: 1,
  accessible: true,
  loading_rule: 3,
  after_midnight: false,
  added: false,
  notes: [],
};

function fix(over: Partial<VesselFix>): VesselFix {
  return {
    id: 37,
    name: "Wenatchee",
    lat: 47.6,
    lon: -122.34,
    speed: 0,
    heading: 0,
    state: "docked",
    insvc: true,
    age_s: 10,
    dep: 7,
    arr: 3,
    left: null,
    eta: null,
    eta_basis: null,
    sched: new Date(D).toISOString(),
    routes: ["sea-bi"],
    pos: 1,
    ...over,
  } as VesselFix;
}

function run(nowMs: number, f: VesselFix | null, cancelled = false) {
  const input: SignalInput = { sailing, cancelled, fix: f, depTerminalId: 7, nowMs };
  return computeSignal(input);
}

describe("cancelled and departed", () => {
  it("cancelled wins over everything", () => {
    const s = run(D - 30 * MIN, fix({}), true);
    expect(s.state).toBe("cancelled");
    expect(s.tone).toBe("muted");
  });

  it("departed: joined fix with LeftDock", () => {
    const f = fix({ state: "underway", left: new Date(D + 4 * MIN).toISOString() });
    const s = run(D + 6 * MIN, f);
    expect(s.state).toBe("departed");
    expect(s.headline).toBe("Sailed at 2:09 PM");
    expect(s.detail).toBe("+4 min");
    expect(s.live).toBe(true);
  });

  it("departed delta suppressed outside 1-120 min plausibility", () => {
    const onTime = fix({ state: "underway", left: new Date(D).toISOString() });
    expect(run(D + 2 * MIN, onTime).detail).toBeNull();
    const absurd = fix({ state: "underway", left: new Date(D + 200 * MIN).toISOString() });
    expect(run(D + 201 * MIN, absurd).detail).toBeNull();
  });
});

describe("dock-confirmed states", () => {
  it("boarding: at dock, 8 min out", () => {
    const s = run(D - 8 * MIN, fix({}));
    expect(s.state).toBe("boarding");
    expect(s.headline).toBe("At the dock - leaves in 8 min");
    expect(s.tone).toBe("red");
  });

  it("leaving-now: at dock at scheduled time", () => {
    const s = run(D, fix({}));
    expect(s.state).toBe("leaving-now");
    expect(s.headline).toBe("Leaving about now");
    expect(s.detail).toBe("Wenatchee is at the dock");
  });

  it("late-start: still at dock past the gone threshold", () => {
    const s = run(D + 5 * MIN, fix({}));
    expect(s.state).toBe("late-start");
    expect(s.headline).toBe("Still at the dock - 5 min past scheduled");
    expect(s.tone).toBe("red");
  });

  it("tight with live dock suffix", () => {
    const s = run(D - 18 * MIN, fix({}));
    expect(s.state).toBe("tight");
    expect(s.tone).toBe("amber");
    expect(s.detail).toBe("Wenatchee is at the dock");
    expect(s.live).toBe(true);
  });

  it("comfortable with live dock suffix", () => {
    const s = run(D - 40 * MIN, fix({}));
    expect(s.state).toBe("comfortable");
    expect(s.headline).toBe("Leaves in 40 min - relax");
    expect(s.tone).toBe("green");
  });
});

describe("late-start while inbound", () => {
  it("assigned boat inbound, ETA past departure + slack", () => {
    const f = fix({
      state: "underway",
      sched: new Date(D - 90 * MIN).toISOString(), // previous leg
      dep: 3,
      arr: 7, // heading to our departure terminal
      eta: new Date(D + 12 * MIN).toISOString(),
    });
    const s = run(D - 10 * MIN, f);
    expect(s.state).toBe("late-start");
    expect(s.headline).toBe("Running at least 12 min behind");
    expect(s.detail).toBe("Wenatchee due 2:17 PM");
  });

  it("a long-gone sailing never inherits the inbound boat's lateness", () => {
    // The live bug this guards: 10 h after the 5:30 AM sailing, its vessel
    // is inbound for an afternoon run - that ETA is not "640 min behind".
    const f = fix({
      state: "underway",
      sched: new Date(D + 600 * MIN).toISOString(),
      dep: 3,
      arr: 7,
      eta: new Date(D + 640 * MIN).toISOString(),
    });
    const s = run(D + 626 * MIN, f);
    expect(s.state).toBe("gone");
  });

  it("implausibly large inbound lateness falls through to schedule truth", () => {
    const f = fix({
      state: "underway",
      sched: new Date(D - 90 * MIN).toISOString(),
      dep: 3,
      arr: 7,
      eta: new Date(D + 200 * MIN).toISOString(), // beyond the 120 min cap
    });
    const s = run(D - 20 * MIN, f);
    expect(s.state).toBe("tight");
    expect(s.live).toBe(false);
  });

  it("inbound but on time falls through to schedule truth", () => {
    const f = fix({
      state: "underway",
      sched: new Date(D - 90 * MIN).toISOString(),
      dep: 3,
      arr: 7,
      eta: new Date(D + 3 * MIN).toISOString(), // within slack
    });
    const s = run(D - 20 * MIN, f);
    expect(s.state).toBe("tight");
    expect(s.live).toBe(false);
    expect(s.detail).toBeNull();
  });
});

describe("schedule-only states", () => {
  it("gone: no fix, past the threshold", () => {
    const s = run(D + 10 * MIN, null);
    expect(s.state).toBe("gone");
    expect(s.headline).toBe("Likely gone");
    expect(s.tone).toBe("muted");
  });

  it("no-signal: the did-it-leave ambiguity window", () => {
    const s = run(D + 2 * MIN, null);
    expect(s.state).toBe("no-signal");
    expect(s.headline).toBe("Scheduled 2:05 PM - no live signal");
    expect(s.tone).toBe("neutral");
  });

  it("leaving-now without a fix stays honest", () => {
    const s = run(D - 6 * MIN, null);
    expect(s.state).toBe("leaving-now");
    expect(s.headline).toBe("Leaves in 6 min");
    expect(s.live).toBe(false);
  });

  it("stale fix is treated as absent", () => {
    const f = fix({ state: "stale", age_s: 900, left: new Date(D).toISOString() });
    expect(run(D + 10 * MIN, f).state).toBe("gone");
  });

  it("boat working a different sailing elsewhere is not evidence", () => {
    const f = fix({ sched: new Date(D + 3 * 60 * MIN).toISOString(), dep: 3, arr: 12 });
    const s = run(D - 30 * MIN, f);
    expect(s.state).toBe("comfortable");
    expect(s.live).toBe(false);
  });
});

describe("threshold boundaries", () => {
  it.each([
    [10, "leaving-now", "red"],
    [11, "tight", "amber"],
    [25, "tight", "amber"],
    [26, "comfortable", "green"],
  ] as const)("t=%i min -> %s", (t, state, tone) => {
    const s = run(D - t * MIN, null);
    expect(s.state).toBe(state);
    expect(s.tone).toBe(tone);
  });

  it("countdown switches to clock time past 120 min", () => {
    expect(run(D - 120 * MIN, null).headline).toBe("Leaves in 120 min - relax");
    expect(run(D - 121 * MIN, null).headline).toBe("Leaves at 2:05 PM");
  });
});
