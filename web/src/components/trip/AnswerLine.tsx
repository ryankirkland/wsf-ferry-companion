import type { Signal } from "@/lib/trip/signal";
import type { Sailing } from "@/lib/trip/types";
import { soundTimeShort } from "@/lib/time/sound-time";
import styles from "./trip.module.css";

/** The whole product in one card: "Next boat: 5:30 PM - leaves in 42 min ·
 * Wenatchee is at the dock". Shown only for today (a future date has no
 * run-or-relax question to answer). */
export function AnswerLine({ next }: { next: { sailing: Sailing; signal: Signal } | null }) {
  if (!next) return null;
  const { sailing, signal } = next;
  return (
    <section className={styles.answer} data-testid="answer-line">
      <div className={styles.answerKicker}>Next boat</div>
      <div className={styles.answerMain}>
        {soundTimeShort(sailing.depart_ms)} - {lowerFirst(signal.headline)}
      </div>
      <div className={styles.answerDetail}>
        {sailing.vessel}
        {signal.detail && signal.detail.startsWith(sailing.vessel)
          ? ` ${signal.detail.slice(sailing.vessel.length + 1)}`
          : signal.detail
            ? ` · ${signal.detail}`
            : ""}
      </div>
    </section>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
