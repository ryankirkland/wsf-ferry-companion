"use client";

import type { ModePreference } from "@/hooks/use-mode";
import { Clock } from "./Clock";
import { ModeSwitcher } from "./ModeSwitcher";
import styles from "./chrome.module.css";

export function TopBar({
  pref,
  onModeChange,
}: {
  pref: ModePreference;
  onModeChange: (p: ModePreference) => void;
}) {
  return (
    <header className={styles.topbar}>
      <h1 className={`display ${styles.wordmark}`}>
        Sound <span>Ferries</span>
      </h1>
      <div className={styles.controls}>
        <ModeSwitcher pref={pref} onChange={onModeChange} />
        <Clock />
      </div>
    </header>
  );
}
