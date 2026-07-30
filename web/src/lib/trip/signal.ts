// The make-it-or-miss-it engine. Pure: (sailing, fleet fix, now) -> signal.
// The join is exact and verified live 6/6: vessellocations.ScheduledDeparture
// equals the schedule's DepartingTime to the epoch millisecond, so
// Date.parse(fix.sched) === sailing.depart_ms identifies "this boat is
// working this sailing". Everything here is either schedule truth or a
// fresh live fact - stale fixes are discarded, never dressed up as live.

import { SIGNAL, STALE_S } from "@/config";
import type { VesselFix } from "@/lib/data/types";
import { soundTimeShort } from "@/lib/time/sound-time";
import type { Sailing } from "./types";

export type SignalState =
  | "cancelled"
  | "departed"
  | "gone"
  | "boarding"
  | "late-start"
  | "leaving-now"
  | "tight"
  | "comfortable"
  | "no-signal";

export type SignalTone = "green" | "amber" | "red" | "muted" | "neutral";

export interface Signal {
  state: SignalState;
  tone: SignalTone;
  /** The answer line, e.g. "Leaves in 42 min - relax". */
  headline: string;
  /** Optional live suffix, e.g. "Wenatchee is at the dock". */
  detail: string | null;
  /** True when a fresh fleet fix backs this signal. */
  live: boolean;
}

export interface SignalInput {
  sailing: Sailing;
  /** Row struck by a matched cancel adjustment (see applyAdjustments). */
  cancelled: boolean;
  /** The fleet row for sailing.vessel_id, or null when absent. */
  fix: VesselFix | null;
  depTerminalId: number;
  nowMs: number;
}

const MIN = 60_000;

function fresh(fix: VesselFix | null): VesselFix | null {
  return fix && fix.state !== "stale" && fix.age_s <= STALE_S ? fix : null;
}

/** Minutes until scheduled departure; positive = still ahead. */
function minutesUntil(departMs: number, nowMs: number): number {
  return Math.round((departMs - nowMs) / MIN);
}

export function computeSignal({ sailing, cancelled, fix, depTerminalId, nowMs }: SignalInput): Signal {
  const departMs = sailing.depart_ms;
  const t = minutesUntil(departMs, nowMs);
  const when = soundTimeShort(departMs);

  if (cancelled) {
    return { state: "cancelled", tone: "muted", headline: "Cancelled", detail: null, live: false };
  }

  const live = fresh(fix);
  if (live) {
    // Working THIS sailing: the verified epoch-ms join.
    const mine = live.sched !== null && Date.parse(live.sched) === departMs;

    if (mine && live.left !== null) {
      const delta = Math.round((Date.parse(live.left) - departMs) / MIN);
      const detail =
        delta >= SIGNAL.minDeltaMin && delta <= SIGNAL.maxDeltaMin ? `+${delta} min` : null;
      return {
        state: "departed",
        tone: "muted",
        headline: `Sailed at ${soundTimeShort(Date.parse(live.left))}`,
        detail,
        live: true,
      };
    }

    if (mine && live.state === "docked") {
      if (t < -SIGNAL.goneAfterMin) {
        return {
          state: "late-start",
          tone: "red",
          headline: `Still at the dock - ${-t} min past scheduled`,
          detail: `${live.name} has not left`,
          live: true,
        };
      }
      if (t <= 0) {
        return {
          state: "leaving-now",
          tone: "red",
          headline: "Leaving about now",
          detail: `${live.name} is at the dock`,
          live: true,
        };
      }
      if (t <= SIGNAL.tightMin) {
        return {
          state: "boarding",
          tone: "red",
          headline: `At the dock - leaves in ${t} min`,
          detail: `${live.name} is loading`,
          live: true,
        };
      }
      // Plenty of time, boat confirmed present: time-truth with a live suffix.
      return timeSignal(t, when, `${live.name} is at the dock`, true);
    }

    // Assigned boat still inbound on a previous leg: it cannot leave before
    // it arrives, so the effective departure is its ETA (max(depart, eta)).
    // Two guards keep this honest: the sailing must not already be gone
    // (a boat inbound NOW says nothing about this morning's 5:30), and the
    // implied lateness must be plausible for one sailing - beyond the cap
    // the inbound leg belongs to some later departure, not this one.
    if (!mine && live.arr === depTerminalId && live.eta !== null && t >= -SIGNAL.goneAfterMin) {
      const etaMs = Date.parse(live.eta);
      const behind = Math.round((etaMs - departMs) / MIN);
      if (etaMs > departMs + SIGNAL.lateStartSlackMin * MIN && behind <= SIGNAL.maxDeltaMin) {
        return {
          state: "late-start",
          tone: "red",
          headline: `Running at least ${behind} min behind`,
          detail: `${live.name} due ${soundTimeShort(etaMs)}`,
          live: true,
        };
      }
    }
  }

  // No usable live evidence for this sailing from here down.
  if (t < -SIGNAL.goneAfterMin) {
    // No "- scheduled X" suffix: every surface showing this sits right
    // next to the scheduled time already.
    return { state: "gone", tone: "muted", headline: "Likely gone", detail: null, live: false };
  }
  if (t < 0) {
    // The one window where "did it leave?" needs live truth we don't have.
    return {
      state: "no-signal",
      tone: "neutral",
      headline: `Scheduled ${when} - no live signal`,
      detail: null,
      live: false,
    };
  }
  if (t <= SIGNAL.tightMin) {
    return {
      state: "leaving-now",
      tone: "red",
      headline: t === 0 ? "Scheduled about now" : `Leaves in ${t} min`,
      detail: null,
      live: false,
    };
  }
  return timeSignal(t, when, null, false);
}

function timeSignal(t: number, when: string, detail: string | null, live: boolean): Signal {
  if (t <= SIGNAL.comfortableMin) {
    return { state: "tight", tone: "amber", headline: `Leaves in ${t} min - keep moving`, detail, live };
  }
  if (t <= SIGNAL.countdownMaxMin) {
    return { state: "comfortable", tone: "green", headline: `Leaves in ${t} min - relax`, detail, live };
  }
  return { state: "comfortable", tone: "green", headline: `Leaves at ${when}`, detail, live };
}
