"use client";

import { SOUND_TZ, TRIP_HORIZON_DAYS } from "@/config";
import { shiftDate } from "@/lib/time/sound-time";
import styles from "./trip.module.css";

const CHIP_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: SOUND_TZ,
  weekday: "short",
  day: "numeric",
});

function chipLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, 1)) return "Tomorrow";
  // Explicit "Fri 31" ordering - locale data varies on weekday/day order.
  const parts = CHIP_FMT.formatToParts(new Date(`${date}T12:00:00-07:00`));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")}`;
}

/** 14 chips, today..+13 - the exact horizon the backend publishes. Deeper
 * dates aren't a UI limitation to apologize for; WSF's own site serves the
 * same window and past dates are unqueryable upstream. */
export function DateStrip({
  today,
  selected,
  onSelect,
}: {
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const dates = Array.from({ length: TRIP_HORIZON_DAYS }, (_, i) => shiftDate(today, i));
  return (
    <div className={styles.dateStrip} role="tablist" aria-label="Travel date" data-testid="date-strip">
      {dates.map((d) => (
        <button
          key={d}
          role="tab"
          aria-selected={d === selected}
          className={`${styles.dateChip} ${d === selected ? styles.dateChipActive : ""}`}
          onClick={() => onSelect(d)}
        >
          {chipLabel(d, today)}
        </button>
      ))}
    </div>
  );
}
