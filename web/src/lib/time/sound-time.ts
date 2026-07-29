// Everything on this product runs on Sound time (America/Los_Angeles),
// regardless of where the viewer is. Mode boundaries per direction.md:
// day 7-17, dusk 17-21 and 5-7, night otherwise.

import { SOUND_TZ } from "@/config";

export type Mode = "day" | "dusk" | "night";

const BOUNDARY_HOURS = [5, 7, 17, 21];

function soundParts(date: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SOUND_TZ,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0) % (type === "hour" ? 24 : 60);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

export function soundHour(date: Date = new Date()): number {
  return soundParts(date).h;
}

export function autoMode(h: number = soundHour()): Mode {
  if (h >= 7 && h < 17) return "day";
  if ((h >= 17 && h < 21) || (h >= 5 && h < 7)) return "dusk";
  return "night";
}

export function soundClock(date: Date = new Date()): string {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SOUND_TZ,
  });
}

export function msToNextMinute(nowMs: number = Date.now()): number {
  return 60_000 - (nowMs % 60_000);
}

/** Milliseconds until the next mode boundary (5/7/17/21 Sound time).
 * Recomputed after every firing, so DST shifts self-correct within one cycle. */
export function msToNextModeBoundary(date: Date = new Date()): number {
  const { h, m, s } = soundParts(date);
  const next = BOUNDARY_HOURS.find((b) => b > h) ?? BOUNDARY_HOURS[0]! + 24;
  const hoursAhead = next - h;
  return ((hoursAhead * 60 - m) * 60 - s) * 1000;
}

/** "as of h:mm" - the staleness voice, always in Sound time. */
export function asOf(date: Date): string {
  return `as of ${soundClock(date)}`;
}

/** "5:30 PM" for an epoch-ms instant, always in Sound time. The narrow
 * no-break space some ICU builds emit is normalized so copy renders (and
 * compares) identically everywhere. */
export function soundTimeShort(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: SOUND_TZ })
    .replace(/ /g, " ");
}

const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: SOUND_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of an instant in Sound time - the service-date axis. */
export function soundDate(date: Date = new Date()): string {
  return YMD.format(date);
}

/** Shift a YYYY-MM-DD calendar date by whole days (date math, no tz drift). */
export function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
