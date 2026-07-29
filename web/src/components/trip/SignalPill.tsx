import type { Signal } from "@/lib/trip/signal";
import styles from "./trip.module.css";

const TONE_CLASS = {
  green: styles.pillGreen,
  amber: styles.pillAmber,
  red: styles.pillRed,
  muted: styles.pillMuted,
  neutral: styles.pillNeutral,
} as const;

const SHORT: Record<Signal["state"], string | null> = {
  cancelled: "Cancelled",
  departed: null, // headline already says "Sailed at ..."
  gone: "Likely gone",
  boarding: "Boarding",
  "late-start": "Running late",
  "leaving-now": "Leaving now",
  tight: "Tight",
  comfortable: "Relax",
  "no-signal": "No live signal",
};

export function SignalPill({ signal }: { signal: Signal }) {
  const label = SHORT[signal.state] ?? signal.headline;
  return <span className={`${styles.pill} ${TONE_CLASS[signal.tone]}`}>{label}</span>;
}
