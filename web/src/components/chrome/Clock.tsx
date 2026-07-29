"use client";

import { useSoundClock } from "@/hooks/use-sound-clock";
import styles from "./chrome.module.css";

export function Clock() {
  return (
    <span className={`display ${styles.clock}`} aria-label="Current time on Puget Sound">
      {useSoundClock()}
    </span>
  );
}
