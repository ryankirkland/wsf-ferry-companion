import { describe, expect, it } from "vitest";
import {
  bestBlock,
  capacityFor,
  findSlot,
  formatDelay,
  formatDriveUp,
  formatPct,
  formatSlotTime,
  hasAnyStats,
  indexCapacity,
  onTimeBand,
  rotateToSlot,
  slotCaveat,
  slotKeyFor,
} from "@/lib/stats/reliability";
import type { CapacityDoc, CapacitySailing, PairStats, SlotStat } from "@/lib/stats/types";

const block = (n: number, pct: number | null, p50 = 2, p90 = 12) => ({
  n,
  ontime_pct: pct,
  p50,
  p90,
});

function slot(over: Partial<SlotStat> = {}): SlotStat {
  return {
    hhmm: "07:55",
    basis: "slot",
    primary: block(80, 91),
    slot_window: block(80, 91),
    all_time: block(5000, 88),
    ...over,
  };
}

describe("on-time bands", () => {
  it("treats the 24-year system average as the top band boundary", () => {
    // The system runs 90.1% all-time, so 90 is "as good as this gets".
    expect(onTimeBand(90)).toBe("strong");
    expect(onTimeBand(89.9)).toBe("mixed");
    expect(onTimeBand(74.9)).toBe("poor");
  });

  it("never colours a missing number", () => {
    expect(onTimeBand(null)).toBe("unknown");
    expect(onTimeBand(undefined)).toBe("unknown");
  });
});

describe("formatting", () => {
  it("renders a missing statistic as a dash, never as zero", () => {
    expect(formatPct(null)).toBe("-");
    expect(formatDelay(null)).toBe("-");
    expect(formatDelay(0.4)).toBe("on time");
    expect(formatDelay(17.8)).toBe("18 min");
  });

  it("turns a slot key into a clock time", () => {
    expect(formatSlotTime("05:30")).toBe("5:30 AM");
    expect(formatSlotTime("00:05")).toBe("12:05 AM");
    expect(formatSlotTime("13:45")).toBe("1:45 PM");
  });
});

describe("slot caveats", () => {
  it("says nothing when the slot speaks for itself", () => {
    expect(slotCaveat(slot(), "last 90 days")).toBeNull();
  });

  it("quantifies how thin a degraded slot is", () => {
    const thin = slot({ basis: "hour", primary: block(310, 81), slot_window: block(4, 25) });
    const text = slotCaveat(thin, "last 90 days");
    expect(text).toContain("4 sailings");
    expect(text).toContain("last 90 days");
    expect(text).toContain("7 AM hour");
  });

  it("handles a slot with no sailings at all in the window", () => {
    const none = slot({ basis: "hour", primary: block(310, 81), slot_window: block(0, null) });
    expect(slotCaveat(none, "last 90 days")).toContain("No sailings at this time");
  });
});

describe("slot identity", () => {
  it("keys a departure by Sound-local time, not UTC", () => {
    // 2026-07-31 05:30 PDT is 12:30 UTC - the slot is 05:30.
    expect(slotKeyFor(Date.UTC(2026, 6, 31, 12, 30))).toBe("05:30");
  });

  it("keeps midnight as 00:00 rather than 24:00", () => {
    expect(slotKeyFor(Date.UTC(2026, 6, 31, 7, 0))).toBe("00:00");
  });

  it("finds the rider's slot and tolerates one that is not published", () => {
    const stats = { slots: [slot({ hhmm: "06:20" })] } as PairStats;
    expect(findSlot(stats, "06:20")?.hhmm).toBe("06:20");
    expect(findSlot(stats, "06:21")).toBeNull();
    expect(findSlot(stats, null)).toBeNull();
  });
});

describe("window fallback", () => {
  it("prefers the recent window and reports which one it used", () => {
    const recent = bestBlock({ primary: block(100, 80), all_time: block(9000, 90) });
    expect(recent.window).toBe("primary");
    const fallback = bestBlock({ primary: block(0, null), all_time: block(9000, 90) });
    expect(fallback.window).toBe("all_time");
    expect(fallback.block.n).toBe(9000);
  });

  it("knows when a pair has nothing to say", () => {
    expect(hasAnyStats(null)).toBe(false);
    expect(
      hasAnyStats({ overall: { primary: block(0, null), all_time: block(0, null) } } as PairStats),
    ).toBe(false);
  });
});

describe("capacity", () => {
  const now = Date.UTC(2026, 6, 31, 20, 0);
  const doc = (over: Partial<CapacityDoc> = {}): CapacityDoc => ({
    v: 1,
    generated_at: new Date(now - 30_000).toISOString(),
    reporting_terminals: [3, 7],
    pairs: {
      "3-7": [
        { depart_ms: now + 600_000, vessel: "Tacoma", cancelled: false, drive_up: 40, level: "plenty", max_space: 120, reservable: null },
      ],
    },
    ...over,
  });

  it("separates a terminal that does not report from one with no space", () => {
    // Friday Harbor publishes nothing; that must not read as "full".
    const view = capacityFor(doc(), 10, 1, now, 240_000);
    expect(view.reporting).toBe(false);
    expect(view.feedQuiet).toBe(false); // others ARE reporting, so the claim is fair
    expect(view.sailings).toBeNull();
  });

  it("an empty overnight feed is not evidence that a terminal never reports", () => {
    // The feed returns [] overnight. Bainbridge publishes space all day, so
    // saying it "does not report" would be false - the page must blame the
    // feed's silence, not the terminal.
    const overnight = doc({ reporting_terminals: [], pairs: {} });
    const view = capacityFor(overnight, 3, 7, now, 240_000);
    expect(view.feedQuiet).toBe(true);
    expect(view.reporting).toBe(false);
  });

  it("returns upcoming sailings for a reporting terminal", () => {
    const view = capacityFor(doc(), 3, 7, now, 240_000);
    expect(view.reporting).toBe(true);
    expect(view.sailings).toHaveLength(1);
    expect(view.stale).toBe(false);
  });

  it("drops departures that have already gone", () => {
    const stale = doc({
      pairs: {
        "3-7": [
          { depart_ms: now - 3_600_000, vessel: "Tacoma", cancelled: false, drive_up: 40, level: "plenty", max_space: 120, reservable: null },
        ],
      },
    });
    expect(capacityFor(stale, 3, 7, now, 240_000).sailings).toHaveLength(0);
  });

  it("flags a reading the poller has not refreshed", () => {
    const old = doc({ generated_at: new Date(now - 600_000).toISOString() });
    expect(capacityFor(old, 3, 7, now, 240_000).stale).toBe(true);
  });
});

describe("indexCapacity - the depart_ms join key", () => {
  const now = Date.UTC(2026, 6, 31, 20, 0);
  const sailing = (over: Partial<CapacitySailing> = {}): CapacitySailing => ({
    depart_ms: now + 600_000,
    vessel: "Tacoma",
    cancelled: false,
    drive_up: 40,
    level: "plenty",
    max_space: 120,
    reservable: null,
    ...over,
  });

  it("keys each reading by its departure instant", () => {
    const map = indexCapacity([sailing(), sailing({ depart_ms: now + 1_200_000, drive_up: 12 })]);
    expect(map.size).toBe(2);
    expect(map.get(now + 600_000)?.drive_up).toBe(40);
    expect(map.get(now + 1_200_000)?.drive_up).toBe(12);
  });

  it("collapses identical twins - the contract does not dedupe its rows", () => {
    const map = indexCapacity([sailing(), sailing()]);
    expect(map.size).toBe(1);
    expect(map.get(now + 600_000)?.drive_up).toBe(40);
  });

  it("DROPS a contested instant rather than printing an arbitrary count", () => {
    // Two readings for one departure that disagree: showing either one is a
    // confident wrong number, so the card shows none.
    const map = indexCapacity([sailing({ drive_up: 40 }), sailing({ drive_up: 3, level: "full" })]);
    expect(map.has(now + 600_000)).toBe(false);
  });

  it("treats a cancellation disagreement as contested too", () => {
    const map = indexCapacity([sailing(), sailing({ cancelled: true })]);
    expect(map.size).toBe(0);
  });
});

describe("drive-up space wording", () => {
  it("prints a plain count when there is room", () => {
    expect(formatDriveUp(63)).toEqual({ text: "63 spaces", full: false });
    expect(formatDriveUp(1)).toEqual({ text: "1 space", full: false });
  });

  it("says Full rather than printing a negative number", () => {
    // WSF's DriveUpSpaceCount goes negative when more vehicles are queued
    // than the boat can take - 2.2% of archived records. "-15 spaces" is
    // not a number of anything; "Full" is the decision the rider needs.
    expect(formatDriveUp(-15)).toEqual({ text: "Full", full: true });
    expect(formatDriveUp(0)).toEqual({ text: "Full", full: true });
  });

  it("distinguishes an unpublished count from a full boat", () => {
    expect(formatDriveUp(null)).toEqual({ text: "not published", full: false });
  });
});

describe("slot display order", () => {
  const mk = (hhmm: string) => ({ hhmm, basis: "slot", primary: block(50, 90), slot_window: block(50, 90), all_time: block(500, 90) }) as SlotStat;
  const slots = ["00:15", "05:30", "12:00", "19:30", "22:45"].map(mk);

  it("starts the table at the rider's slot and wraps", () => {
    // An evening rider's collapsed table previously showed only the
    // after-midnight sailings - the least relevant six on the schedule.
    expect(rotateToSlot(slots, "19:30").map((s) => s.hhmm)).toEqual([
      "19:30", "22:45", "00:15", "05:30", "12:00",
    ]);
  });

  it("keeps clock order when there is no focus slot", () => {
    expect(rotateToSlot(slots, null).map((s) => s.hhmm)).toEqual([
      "00:15", "05:30", "12:00", "19:30", "22:45",
    ]);
  });

  it("wraps to the start after the last sailing of the day", () => {
    expect(rotateToSlot(slots, "23:50")[0]?.hhmm).toBe("00:15");
  });
});
