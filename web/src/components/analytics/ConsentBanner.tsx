"use client";

// A small, honest heads-up: tracking is on by default (anonymous, never
// for advertising), and this banner exists only so a first-time visitor
// knows that and can opt out. Dismissing "Got it" does not start
// tracking - it was already running - it just stops the banner reappearing.

import { useEffect, useState } from "react";
import {
  ANALYTICS_OPTOUT_KEY,
  CONSENT_SEEN_KEY,
  readStorage,
  writeStorage,
} from "@/lib/storage";
import styles from "./consent-banner.module.css";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Async resolution (same pattern as useAuth.refresh) keeps this out of
    // the render/effect-sync path the set-state-in-effect lint rule guards.
    // Private mode reads null -> banner shows, which is the honest default.
    const t = window.setTimeout(() => {
      setVisible(readStorage(CONSENT_SEEN_KEY) !== "1");
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = (optOut: boolean) => {
    if (optOut) writeStorage(ANALYTICS_OPTOUT_KEY, "1");
    writeStorage(CONSENT_SEEN_KEY, "1");
    setVisible(false);
  };

  return (
    <div className={styles.banner} role="status" data-testid="consent-banner">
      <p className={styles.copy}>
        We log anonymous page visits and clicks - never anything that identifies you, never for
        advertising - just to catch bugs and see where traffic comes from.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.optOut} onClick={() => dismiss(true)}>
          Opt out
        </button>
        <button type="button" className={styles.gotIt} onClick={() => dismiss(false)}>
          Got it
        </button>
      </div>
    </div>
  );
}
