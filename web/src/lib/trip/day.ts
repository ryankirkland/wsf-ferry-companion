// Day-view assembly: strike cancelled rows, surface unpinnable cancels as
// ghost slots, and merge yesterday's post-midnight tail before 3 AM Sound
// time. timeadj is annotation, never schedule math - /schedule/{date}
// already applies adjustments to Times, so we only decorate.

import { shiftDate, soundLocalMs } from "@/lib/time/sound-time";
import type { Adjustment, PairDay, Sailing } from "./types";

/** A timeadj cancel with no row to strike. WSF drops advance-published
 * (tidal) cancels from /schedule/{date} itself, so the sailing is simply
 * absent from the list - a rider looking for "the 2:05" would find
 * nothing. The ghost holds the slot: it renders in the list at the
 * cancelled time, not as a note floating above the day. */
export interface GhostCancel {
  /** The cancelled slot as an instant - orders the ghost among real rows. */
  depart_ms: number;
  /** Sound-local HH:MM as WSF published it. */
  time_local: string;
  /** e.g. "tidal cancellation". */
  reason: string;
  tidal: boolean;
  /** True when the builder could pin the cancel to THIS pair (two-terminal
   * route). On a multi-terminal route (Fauntleroy/Vashon/Southworth, the
   * San Juans) timeadj names only the departure terminal, so the cancelled
   * boat may have been bound elsewhere - the row must say so. */
  certain: boolean;
}

export interface DayView {
  sailings: Sailing[];
  /** depart_ms values struck by a matched cancel at the departure terminal. */
  cancelledMs: Set<number>;
  /** Reason per struck sailing, e.g. "tidal cancellation". */
  cancelReason: Map<number, string>;
  /** Hedged notes for rows an UNMATCHED cancel names by time: the sailing
   * is still published, and on a multi-terminal route the cancel may be
   * another destination's - so the row stays live and carries the doubt. */
  rowNotes: Map<number, string>;
  /** Cancels with no row at their time, sorted by slot. */
  ghosts: GhostCancel[];
}

/** WSF's service day runs past midnight: an HH:MM before 03:00 in a
 * day's file names the following calendar morning (the same rule that
 * tags after_midnight rows). */
function slotMs(serviceDate: string, hhmm: string): number {
  const afterMidnight = hhmm < "03:00";
  return soundLocalMs(afterMidnight ? shiftDate(serviceDate, 1) : serviceDate, hhmm);
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
  const rowNotes = new Map<number, string>();
  // Keyed by slot instant: yesterday's file and today's can carry the same
  // cancel, and the reader should see that slot once.
  const ghosts = new Map<number, GhostCancel>();

  // Yesterday's file contributes only its post-midnight tail - the part of
  // that service day this list shows. Its afternoon cancels must neither
  // strike today's same-HH:MM sailing nor ghost into today.
  const files: { doc: PairDay; tailOnly: boolean }[] = [
    ...(yesterday ? [{ doc: yesterday, tailOnly: true }] : []),
    { doc: today, tailOnly: false },
  ];
  for (const { doc, tailOnly } of files) {
    for (const adj of doc.adjustments) {
      if (adj.type !== "cancel") continue; // additions are badged by the builder
      if (tailOnly && adj.time_local >= "03:00") continue;
      const ms = slotMs(doc.service_date, adj.time_local);
      // Minute-granular: timeadj carries HH:MM, and the instant compare is
      // what keeps yesterday's 22:00 from striking today's 22:00.
      const row = sailings.find((s) => Math.floor(s.depart_ms / 60_000) === Math.floor(ms / 60_000));
      if (row && adj.matched) {
        cancelledMs.add(row.depart_ms);
        cancelReason.set(row.depart_ms, reason(adj));
      } else if (row) {
        rowNotes.set(
          row.depart_ms,
          `WSF lists a ${adj.time_local} ${reason(adj)} from this terminal - it may be this sailing`,
        );
      } else {
        ghosts.set(ms, {
          depart_ms: ms,
          time_local: adj.time_local,
          reason: reason(adj),
          tidal: adj.tidal,
          certain: adj.matched,
        });
      }
    }
  }
  return {
    sailings,
    cancelledMs,
    cancelReason,
    rowNotes,
    ghosts: [...ghosts.values()].sort((a, b) => a.depart_ms - b.depart_ms),
  };
}
