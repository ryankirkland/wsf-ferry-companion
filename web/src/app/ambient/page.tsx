"use client";

import { Clock } from "@/components/chrome/Clock";
import { useMode } from "@/hooks/use-mode";
import styles from "./ambient.module.css";

// Ambient mode ("frame on a wall"): completed in a later PR - this stub
// establishes the /ambient route, auto mode, and the clock.
export default function Ambient() {
  useMode(); // auto only; no switcher in ambient

  return (
    <main className={styles.stage}>
      <div className={styles.clockCorner}>
        <Clock />
      </div>
    </main>
  );
}
