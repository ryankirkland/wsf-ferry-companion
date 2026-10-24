import { describe, expect, it } from "vitest";
import {
  AQI_MAX_AGE_MS,
  AQI_MAX_FUTURE_MS,
  aqiTone,
  currentAqi,
  hourFor,
  nowRow,
  type HourRow,
  type TerminalAqi,
  type TerminalWx,
} from "@/lib/data/weather";

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

describe("currentAqi - never show old air quality as current", () => {
  const observedMs = Date.UTC(2026, 9, 24, 21, 0);
  const aqi: TerminalAqi = {
    aqi: 28,
    category: "Good",
    pollutant: "PM2.5",
    area: "Seattle-Bellevue-Kent Valley",
    site: "Seattle-10th & Weller",
    observed_date: "2026-10-24",
    observed_hour: 14,
    observed_at: "2026-10-24T21:00:00Z",
  };
  const wx = (a: TerminalAqi | null): TerminalWx => ({ name: "Seattle", aqi: a });

  it("shows a reading inside the cap, up to and including its edge", () => {
    expect(currentAqi(wx(aqi), observedMs + 30 * 60_000)).toBe(aqi);
    expect(currentAqi(wx(aqi), observedMs + AQI_MAX_AGE_MS)).toBe(aqi);
  });

  it("withdraws a reading past the cap - a dead pipeline leaves its last file behind", () => {
    expect(currentAqi(wx(aqi), observedMs + AQI_MAX_AGE_MS + 1)).toBeNull();
  });

  it("withdraws a pre-migration entry with no observation time (the 2026-10-01 bug)", () => {
    const legacy: TerminalAqi = { ...aqi, observed_at: undefined };
    expect(currentAqi(wx(legacy), observedMs)).toBeNull();
  });

  it("withdraws a reading stamped implausibly far in the future", () => {
    expect(currentAqi(wx(aqi), observedMs - AQI_MAX_FUTURE_MS)).toBe(aqi);
    expect(currentAqi(wx(aqi), observedMs - AQI_MAX_FUTURE_MS - 1)).toBeNull();
  });

  it("rejects junk that Date.parse would still read as a date", () => {
    // V8 parses this unresolved fixture placeholder as 2040-01-01.
    expect(Number.isFinite(Date.parse("%%ISO-40%%"))).toBe(true);
    expect(currentAqi(wx({ ...aqi, observed_at: "%%ISO-40%%" }), observedMs)).toBeNull();
    expect(currentAqi(wx({ ...aqi, observed_at: "2040" }), observedMs)).toBeNull();
  });

  it("withdraws an unparseable time and handles absent AQI", () => {
    expect(currentAqi(wx({ ...aqi, observed_at: "nope" }), observedMs)).toBeNull();
    expect(currentAqi(wx(null), observedMs)).toBeNull();
    expect(currentAqi(undefined, observedMs)).toBeNull();
  });
});
