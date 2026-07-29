import { describe, expect, it } from "vitest";
import {
  asOf,
  autoMode,
  msToNextMinute,
  msToNextModeBoundary,
  soundHour,
} from "@/lib/time/sound-time";

describe("autoMode boundaries (Sound time)", () => {
  it.each([
    [0, "night"],
    [4, "night"],
    [5, "dusk"],
    [6, "dusk"],
    [7, "day"],
    [12, "day"],
    [16, "day"],
    [17, "dusk"],
    [20, "dusk"],
    [21, "night"],
    [23, "night"],
  ] as const)("hour %i -> %s", (h, expected) => {
    expect(autoMode(h)).toBe(expected);
  });
});

describe("Sound-time conversions", () => {
  // 2026-07-29T12:00:00Z is 05:00 PDT (UTC-7 in July).
  const fiveAmPdt = new Date("2026-07-29T12:00:00Z");

  it("converts UTC to Sound hours across the DST offset", () => {
    expect(soundHour(fiveAmPdt)).toBe(5);
    // 2026-01-15T12:00:00Z is 04:00 PST (UTC-8 in January).
    expect(soundHour(new Date("2026-01-15T12:00:00Z"))).toBe(4);
  });

  it("computes ms to the next mode boundary", () => {
    // At exactly 05:00 the next boundary is 07:00 -> two hours.
    expect(msToNextModeBoundary(fiveAmPdt)).toBe(2 * 3600 * 1000);
    // At 22:30 the next boundary wraps to 05:00 -> 6.5 hours.
    const tenThirtyPm = new Date("2026-07-30T05:30:00Z");
    expect(msToNextModeBoundary(tenThirtyPm)).toBe(6.5 * 3600 * 1000);
  });
});

describe("clock alignment", () => {
  it("targets the next minute exactly", () => {
    expect(msToNextMinute(60_000 * 10 + 12_345)).toBe(60_000 - 12_345);
    expect(msToNextMinute(60_000)).toBe(60_000);
  });
});

describe("staleness voice", () => {
  it("formats as-of in Sound time", () => {
    expect(asOf(new Date("2026-07-29T19:05:00Z"))).toMatch(/^as of 12:05/);
  });
});
