"use client";

import { MapView } from "@/components/MapView";
import { Clock } from "@/components/chrome/Clock";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./ambient.module.css";

// Ambient mode ("frame on a wall"): hardening (wake lock, daily reload)
// lands in the ambient PR; this renders the inert map + clock.
export default function Ambient() {
  const { mode } = useMode(); // auto only; no switcher in ambient
  const fleet = useFleet();

  return (
    <main className={styles.stage}>
      <MapView mode={mode} fleet={fleet} ambient />
      <div className={styles.clockCorner}>
        <Clock />
      </div>
    </main>
  );
}
