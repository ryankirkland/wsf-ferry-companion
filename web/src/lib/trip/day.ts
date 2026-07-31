// Day-view assembly: strike cancelled rows, surface unmatched adjustments
// as day-level notes, and merge yesterday's post-midnight tail before 3 AM
// Sound time. timeadj is annotation, never schedule math - /schedule/{date}
// already applies adjustments to Times, so we only decorate.

import { SOUND_TZ } from "@/config";
import type { Adjustment, PairDay, Sailing } from "./types";

export interface DayView {
  sailings: Sailing[];
  /** depart_ms values struck by a matched cancel at the departure terminal. */
  cancelledMs: Set<number>;
  /** Reason per struck sailing, e.g. "tidal cancellation". */
  cancelReason: Map<number, string>;
  /** Adjustments we could not pin to a row - shown as day-level notes. */
  dayNotes: string[];
}

const HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: SOUND_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function localHHMM(ms: number): string {
  return HHMM.format(new Date(ms));
}

function reason(adj: Adjustment): string {
  return adj.tidal ? "tidal cancellation" : "cancelled by WSF";
}

/**
 * Merge today's file with yesterday's post-midnight tail. Before ~3 AM the
 * boats still running belong to yesterday's service day; its after_midnight
 * rows are this morning's sailings. Dedup on (vessel_id, depart_ms) - the
 * builder already dedups across files, this is belt and suspenders.
 */
export function mergeDays(today: PairDay, yesterday: PairDay | null): Sailing[] {
  const rows = [...(yesterday?.sailings.filter((s) => s.after_midnight) ?? []), ...today.sailings];
  const seen = new Set<string>();
  const out: Sailing[] = [];
  for (const s of rows) {
    const key = `${s.vessel_id}:${s.depart_ms}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.depart_ms - b.depart_ms);
}

/** Decorate merged sailings with the adjustments of the files they came from. */
export function buildDayView(today: PairDay, yesterday: PairDay | null = null): DayView {
  const sailings = mergeDays(today, yesterday);
  const cancelledMs = new Set<number>();
  const cancelReason = new Map<number, string>();
  // A Set, not an array: yesterday's file and today's can carry the same
  // unmatched adjustment, and the reader should see that cancellation once.
  const dayNotes = new Set<string>();

  const adjustments = [...(yesterday?.adjustments ?? []), ...today.adjustments];
  for (const adj of adjustments) {
    if (adj.type !== "cancel") continue; // additions are badged by the builder
    const row = adj.matched
      ? sailings.find((s) => localHHMM(s.depart_ms) === adj.time_local)
      : undefined;
    if (row) {
      cancelledMs.add(row.depart_ms);
      cancelReason.set(row.depart_ms, reason(adj));
    } else {
      dayNotes.add(
        `A ${adj.time_local} departure from this terminal area is cancelled (${reason(adj)}) - ` +
          "check the alert for details.",
      );
    }
  }
  return { sailings, cancelledMs, cancelReason, dayNotes: [...dayNotes] };
}
