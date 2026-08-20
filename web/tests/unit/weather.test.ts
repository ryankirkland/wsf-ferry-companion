import { describe, expect, it } from "vitest";
import { aqiTone, hourFor, nowRow, type HourRow, type TerminalWx } from "@/lib/data/weather";

const HOUR = 3_600_000;
const base = Date.UTC(2026, 7, 20, 15, 0);
const row = (i: number, temp = 60 + i): HourRow => [base + i * HOUR, temp, "partly", 0, 5, "N", "Partly"];

const terminal: TerminalWx = {
  name: "Seattle",
  as_of: "2026-08-20T14:26:00+00:00",
  hours: [row(0), row(1), row(2), row(3)],
};

describe("hourFor - the horizon honesty rule", () => {
  it("returns the hour containing the sailing", () => {
    expect(hourFor(terminal, base + 1.5 * HOUR)?.[1]).toBe(61);
  });

  it("returns NOTHING past the published horizon - never extrapolates", () => {
    expect(hourFor(terminal, base + 10 * HOUR)).toBeNull();
    expect(hourFor(terminal, base - 5 * HOUR)).toBeNull();
  });

  it("tolerates the sailing sitting just inside the edges", () => {
    expect(hourFor(terminal, base + 3.4 * HOUR)?.[1]).toBe(63);
    expect(hourFor(terminal, base - 0.5 * HOUR)?.[1]).toBe(60);
  });

  it("handles uncovered terminals (Sidney) without pretending", () => {
    expect(hourFor({ name: "Sidney B.C.", unavailable: "x" }, base)).toBeNull();
    expect(nowRow({ name: "Sidney B.C." })).toBeNull();
  });
});

describe("aqiTone - EPA thresholds, not ours", () => {
  it("maps the category boundaries exactly", () => {
    expect(aqiTone(50)).toBe("good");
    expect(aqiTone(51)).toBe("moderate");
    expect(aqiTone(100)).toBe("moderate");
    expect(aqiTone(101)).toBe("usg");
    expect(aqiTone(150)).toBe("usg");
    expect(aqiTone(151)).toBe("unhealthy");
    expect(aqiTone(201)).toBe("severe");
  });
});
