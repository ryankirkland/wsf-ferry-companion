"use client";

// Ambient mode ("frame on a wall"): the map, a clock, and the 24 h
// guarantees (wake lock, daily reload, outage-recovery reload). Client
// leaf under a server page so the route can carry its own metadata.
// The owner's walk (2026-08-19) added three things: the map stays
// interactive (the inert display surprised people), an entry tooltip
// says what this screen is, and a quiet corner button is the way out.

import Link from "next/link";
import { useEffect, useState } from "react";
import { MapView } from "@/components/MapView";
import { Clock } from "@/components/chrome/Clock";
import { useAmbientGuard } from "@/hooks/use-ambient-guard";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./ambient.module.css";

const TIP_MS = 7_000;

export function AmbientStage() {
  const { mode } = useMode(); // auto only; no switcher in ambient
  const fleet = useFleet();
  useAmbientGuard(fleet.feedState);

  const [tipGone, setTipGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTipGone(true), TIP_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className={styles.stage}>
      <MapView mode={mode} fleet={fleet} ambient />
      <div className={styles.clockCorner}>
        <Clock />
      </div>
      <p className={`${styles.tip} ${tipGone ? styles.tipGone : ""}`} role="status" data-testid="ambient-tip">
        Ambient mode: the live Sound, quietly updating all day - made to be left on a wall.
      </p>
      <Link
        href="/"
        className={styles.exit}
        aria-label="Back to the map"
        data-analytics-label="ambient-exit"
        data-testid="ambient-exit"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none">
          <path d="M3.5 15.5h17l-1.6 3.2a2 2 0 0 1-1.8 1.1H6.9a2 2 0 0 1-1.8-1.1z" fill="currentColor" />
          <path d="M6.5 15V11a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 10V7.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V10" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </Link>
    </main>
  );
}
