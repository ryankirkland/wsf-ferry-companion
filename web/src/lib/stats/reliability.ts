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

/** Index a pair's capacity readings by departure instant - the join key the
 * trip page uses, because WSF stamps the same scheduled-departure time on
 * the space feed and the schedule feed.
 *
 * `build_contract` appends one entry per (departure x arrival-terminal row)
 * with no dedupe, so a pair CAN in principle carry two entries at the same
 * instant. Identical twins collapse harmlessly; two entries that disagree are
 * DROPPED rather than resolved by array order - showing an arbitrary one of
 * two contradictory counts is the kind of confident wrong number this project
 * does not print. (Unverified in the wild: the archived overnight samples are
 * empty, so this is a guard, not a fix for something observed.)
 */
export function indexCapacity(sailings: CapacitySailing[]): Map<number, CapacitySailing> {
  const byDeparture = new Map<number, CapacitySailing>();
  const contested = new Set<number>();
  for (const sailing of sailings) {
    const seen = byDeparture.get(sailing.depart_ms);
    if (
      seen &&
      (seen.drive_up !== sailing.drive_up ||
        seen.level !== sailing.level ||
        seen.cancelled !== sailing.cancelled)
    ) {
      contested.add(sailing.depart_ms);
    }
    byDeparture.set(sailing.depart_ms, sailing);
  }
  for (const ms of contested) byDeparture.delete(ms);
  return byDeparture;
}

/** How many drive-up spaces to show for a sailing.
 *
 * WSF's DriveUpSpaceCount goes NEGATIVE when more vehicles are queued than
 * the boat can take - 197 of 9,111 archived records (2.2%), always with
 * their own red fullness colour. Printing that raw gives a rider
 * "-15 spaces", which is not a number of anything. At or below zero the
 * honest word is "Full": the count still says the sailing cannot take you,
 * which is the decision the rider is making.
 *
 * The contract keeps WSF's raw value; only the presentation changes.
 */
export function formatDriveUp(spaces: number | null): { text: string; full: boolean } {
  if (spaces === null) return { text: "not published", full: false };
  if (spaces <= 0) return { text: "Full", full: true };
  return { text: `${spaces} ${spaces === 1 ? "space" : "spaces"}`, full: false };
}

/** Order slots for display, starting at the rider's own and wrapping.
 *
 * The contract sorts slots from 00:00, so the collapsed six-row table
 * showed an evening rider nothing but after-midnight sailings - the six
 * LEAST relevant ones - while "Your 7:30 PM sailing" sat highlighted
 * directly above. Starting at the rider's slot makes the visible rows the
 * ones around their decision; with no focus slot the clock order stands.
 */
export function rotateToSlot(slots: SlotStat[], hhmm: string | null): SlotStat[] {
  if (!hhmm) return slots;
  const index = slots.findIndex((s) => s.hhmm >= hhmm);
  if (index <= 0) return slots;
  return [...slots.slice(index), ...slots.slice(0, index)];
}
