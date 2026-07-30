import type { Signal } from "@/lib/trip/signal";
import styles from "./trip.module.css";

const TONE_CLASS = {
  green: styles.pillGreen,
  amber: styles.pillAmber,
  red: styles.pillRed,
  muted: styles.pillMuted,
  neutral: styles.pillNeutral,
} as const;

// tight/comfortable carry no pill: the countdown in the row meta already
// says everything, and a page of green "Relax" chips was visual noise
// (Ryan's call, 2026-07-29). Pills mark only the states that demand a
// glance: boarding, leaving now, running late, departed/gone, no-signal.
const SHORT: Record<Signal["state"], string | null> = {
  cancelled: "Cancelled",
  departed: null, // headline already says "Sailed at ..."
  gone: "Likely gone",
  boarding: "Boarding",
  "late-start": "Running late",
  "leaving-now": "Leaving now",
  tight: null,
  comfortable: null,
  "no-signal": "No live signal",
};

export function SignalPill({ signal }: { signal: Signal }) {
  if (signal.state === "tight" || signal.state === "comfortable") return null;
  const label = SHORT[signal.state] ?? signal.headline;
  return <span className={`${styles.pill} ${TONE_CLASS[signal.tone]}`}>{label}</span>;
}
