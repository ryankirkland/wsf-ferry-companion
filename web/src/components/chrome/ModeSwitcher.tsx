"use client";

import type { ModePreference } from "@/hooks/use-mode";
import styles from "./chrome.module.css";

const OPTIONS: ModePreference[] = ["auto", "day", "dusk", "night"];

export function ModeSwitcher({
  pref,
  onChange,
}: {
  pref: ModePreference;
  onChange: (p: ModePreference) => void;
}) {
  return (
    <div className={styles.modes} role="group" aria-label="Color mode">
      {OPTIONS.map((opt) => (
        <button
          key={opt}
          className={`${styles.modeBtn} ${pref === opt ? styles.modeOn : ""}`}
          aria-pressed={pref === opt}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
