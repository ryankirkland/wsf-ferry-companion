"use client";

// First-visit provenance card (owner's ask, 2026-08-20): say where the
// data comes from and who to email when something looks wrong. Shows
// once; "Got it" remembers the dismissal. Same async-read pattern as
// ConsentBanner - private mode reads null and shows the card, which is
// the honest default.

import { useEffect, useState } from "react";
import { DATA_NOTICE_SEEN_KEY, readStorage, writeStorage } from "@/lib/storage";
import styles from "./data-notice.module.css";

export const FEEDBACK_EMAIL = "ryankirkland.py@gmail.com";

export function DataNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setVisible(readStorage(DATA_NOTICE_SEEN_KEY) !== "1");
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    writeStorage(DATA_NOTICE_SEEN_KEY, "1");
    setVisible(false);
  };

  return (
    <div className={styles.card} role="status" data-testid="data-notice">
      <p className={styles.copy}>
        Ferry positions, schedules, and alerts come from Washington State Ferries (WSDOT);
        weather from the National Weather Service; air quality from AirNow (EPA). Sound Ferries
        is an independent rider-built project, not affiliated with WSDOT. Spot something
        wrong? <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
      </p>
      <button type="button" className={styles.gotIt} onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
