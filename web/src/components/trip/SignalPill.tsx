import type { Signal } from "@/lib/trip/signal";
import styles from "./trip.module.css";

const TONE_CLASS = {
  green: styles.pillGreen,
  amber: styles.pillAmber,
  red: styles.pillRed,
  muted: styles.pillMuted,
  neutral: styles.pillNeutral,
} as const;

// tight/comfortable/gone carry no pill: the row meta already says
// everything, and repeated chips were visual noise (Ryan's calls,
// 2026-07-29). Pills mark only the states that demand a glance:
// boarding, leaving now, running late, departed, no-signal.
const SHORT: Record<Signal["state"], string | null> = {
  cancelled: "Cancelled",
  departed: null, // headline already says "Sailed at ..."
  gone: null,
  boarding: "Boarding",
  "late-start": "Running late",
  "leaving-now": "Leaving now",
  tight: null,
  comfortable: null,
  "no-signal": "No live signal",
};

const NO_PILL = new Set<Signal["state"]>(["tight", "comfortable", "gone"]);

export function SignalPill({ signal }: { signal: Signal }) {
  if (NO_PILL.has(signal.state)) return null;
  const label = SHORT[signal.state] ?? signal.headline;
  return <span className={`${styles.pill} ${TONE_CLASS[signal.tone]}`}>{label}</span>;
}
