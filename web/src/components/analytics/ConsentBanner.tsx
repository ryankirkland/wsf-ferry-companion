"use client";

// A small, honest heads-up: tracking is on by default (anonymous, never
// for advertising), and this banner exists only so a first-time visitor
// knows that and can opt out. Dismissing "Got it" does not start
// tracking - it was already running - it just stops the banner reappearing.

import { useEffect, useState } from "react";
import styles from "./consent-banner.module.css";

const SEEN_KEY = "wsf_analytics_consent_seen";
const OPTOUT_KEY = "wsf_analytics_optout";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Async resolution (same pattern as useAuth.refresh) keeps this out of
    // the render/effect-sync path the set-state-in-effect lint rule guards.
    const t = window.setTimeout(() => {
      try {
        setVisible(window.localStorage.getItem(SEEN_KEY) !== "1");
      } catch {
        // Private mode / storage disabled: say nothing rather than error.
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!visible) return null;

  const dismiss = (optOut: boolean) => {
    try {
      if (optOut) window.localStorage.setItem(OPTOUT_KEY, "1");
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Nothing to persist - hide anyway rather than nag every load.
    }
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
