// Calendar grouping over the real fixture (generated from the golden
// timeadj feed via the same builder that runs in Lambda) plus grid-shape
// invariants and the soundStamp voice.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCalendar } from "@/lib/trip/calendar";
import { soundStamp } from "@/lib/time/sound-time";
import { isAdjustmentsDoc, type AdjustmentsDoc } from "@/lib/trip/types";

const doc = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../public/dev-fixtures/adjustments.json"), "utf8"),
) as AdjustmentsDoc;

describe("adjustments fixture", () => {
  it("passes the runtime guard", () => {
    expect(isAdjustmentsDoc(doc)).toBe(true);
  });
});

describe("buildCalendar", () => {
  const months = buildCalendar(doc);

  it("only emits months that contain entries, in order", () => {
    expect(months.length).toBeGreaterThanOrEqual(4); // Aug..Dec in the golden feed
    const keys = months.map((m) => m.key);
    expect(keys).toEqual([...keys].sort());
    for (const m of months) {
      expect(m.cancels + m.adds).toBeGreaterThan(0);
    }
  });

  it("grids are padded Sunday-first weeks of 7", () => {
    for (const m of months) {
      for (const week of m.weeks) expect(week).toHaveLength(7);
      const days = m.weeks.flat().filter((d) => d !== null);
      // 2026-08-01 is a Saturday: August's first week has 6 pads.
      expect(days[0]!.dayNum).toBe(1);
      expect(days.at(-1)!.dayNum).toBe(days.length);
    }
    const august = months.find((m) => m.key === "2026-08")!;
    expect(august.weeks[0]!.filter((c) => c === null)).toHaveLength(6);
  });

  it("the Aug-10 tidal cancels land on the right cell", () => {
    const august = months.find((m) => m.key === "2026-08")!;
    const day10 = august.weeks.flat().find((d) => d?.date === "2026-08-10")!;
    expect(day10.entries.length).toBeGreaterThanOrEqual(2); // both directions
    expect(day10.entries.every((e) => e.tidal && e.type === "cancel")).toBe(true);
  });

  it("counts adds and cancels separately", () => {
    const august = months.find((m) => m.key === "2026-08")!;
    expect(august.adds).toBeGreaterThan(0); // the Aug-12 tidal add-back
    expect(august.cancels).toBeGreaterThan(august.adds);
  });
});

describe("soundStamp", () => {
  const now = new Date("2026-01-15T22:05:00Z"); // 2:05 PM PST

  it("same Sound day -> clock time", () => {
    expect(soundStamp("2026-01-15T17:30:00Z", now)).toBe("9:30 AM");
  });

  it("other days -> short date", () => {
    expect(soundStamp("2026-01-13T17:30:00Z", now)).toBe("Jan 13");
  });

  it("UTC evening that is still the same Sound day stays a clock time", () => {
    // 2026-01-16T05:00Z is 9 PM Jan 15 in Sound time.
    expect(soundStamp("2026-01-16T05:00:00Z", now)).toBe("9:00 PM");
  });

  it("garbage input -> empty string", () => {
    expect(soundStamp("not-a-date", now)).toBe("");
  });
});
