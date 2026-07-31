// Presentation logic for the reliability section, kept out of the
// components so the honesty rules are unit-testable.
//
// The governing rule: a number never appears without the evidence behind
// it. On-time bands, degraded slots, and sparse windows all resolve to an
// explicit label rather than a bare percentage.

import type { CapacityDoc, CapacitySailing, PairStats, SlotStat, StatBlock } from "./types";

export type OnTimeBand = "strong" | "mixed" | "poor" | "unknown";

/** Bands chosen against the real distribution: the 24-year system average
 *  is 90.1%, so 90 is "as good as this system gets", and the worst pairs
 *  sit near 30%. */
export function onTimeBand(pct: number | null | undefined): OnTimeBand {
  if (pct === null || pct === undefined) return "unknown";
  if (pct >= 90) return "strong";
  if (pct >= 75) return "mixed";
  return "poor";
}

export function formatPct(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? "-" : `${Math.round(pct)}%`;
}

/** Delay minutes read better as whole minutes; sub-minute means "on the dot". */
export function formatDelay(min: number | null | undefined): string {
  if (min === null || min === undefined) return "-";
  if (min < 1) return "on time";
  return `${Math.round(min)} min`;
}

export function formatSampleSize(n: number): string {
  return `${n.toLocaleString()} sailing${n === 1 ? "" : "s"}`;
}

/** "05:30" -> "5:30 AM", without dragging a date through it. */
export function formatSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The one-line explanation a degraded slot owes the reader. */
export function slotCaveat(slot: SlotStat, window: string): string | null {
  if (slot.basis !== "hour") return null;
  const own = slot.slot_window.n;
  const hour = formatSlotTime(`${slot.hhmm.slice(0, 2)}:00`).replace(":00", "");
  return own === 0
    ? `No sailings at this time in the ${window} - showing the ${hour} hour instead.`
    : `Only ${formatSampleSize(own)} at this exact time in the ${window}, so this is the ${hour} hour.`;
}

/** Milliseconds -> the slot key the stats contract uses ("HH:MM" Sound time). */
export function slotKeyFor(departMs: number, timeZone = "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(departMs));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

export function findSlot(stats: PairStats | null, hhmm: string | null): SlotStat | null {
  if (!stats || hhmm === null) return null;
  return stats.slots.find((s) => s.hhmm === hhmm) ?? null;
}

/** True when there is genuinely nothing to say about this pair. */
export function hasAnyStats(stats: PairStats | null): boolean {
  return !!stats && (stats.overall.primary.n > 0 || stats.overall.all_time.n > 0);
}

/** Prefer the window a rider cares about, fall back to all-time, and tell
 *  the caller which one it handed back. */
export function bestBlock(pair: {
  primary: StatBlock;
  all_time: StatBlock;
}): { block: StatBlock; window: "primary" | "all_time" } {
  return pair.primary.n > 0
    ? { block: pair.primary, window: "primary" }
    : { block: pair.all_time, window: "all_time" };
}

export interface CapacityView {
  /** null unless this terminal is currently publishing drive-up data. */
  sailings: CapacitySailing[] | null;
  reporting: boolean;
  /** No terminal anywhere is publishing - the feed goes quiet overnight.
   *  Distinct from `reporting: false`, which is a claim about THIS
   *  terminal and must not be made while the whole feed is empty. */
  feedQuiet: boolean;
  stale: boolean;
  asOfMs: number | null;
}

export function capacityFor(
  doc: CapacityDoc | null,
  dep: number,
  arr: number,
  nowMs: number,
  staleMs: number,
): CapacityView {
  if (!doc) {
    return { sailings: null, reporting: false, feedQuiet: false, stale: false, asOfMs: null };
  }
  const parsed = Date.parse(doc.generated_at);
  const asOfMs = Number.isFinite(parsed) ? parsed : null;
  const stale = asOfMs !== null && nowMs - asOfMs > staleMs;
  const feedQuiet = doc.reporting_terminals.length === 0;
  const reporting = doc.reporting_terminals.includes(dep);
  if (!reporting) return { sailings: null, reporting: false, feedQuiet, stale, asOfMs };
  const sailings = (doc.pairs[`${dep}-${arr}`] ?? []).filter((s) => s.depart_ms >= nowMs - 300_000);
  return { sailings, reporting: true, feedQuiet, stale, asOfMs };
}
