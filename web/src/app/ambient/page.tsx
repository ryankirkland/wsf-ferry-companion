"use client";

import { MapView } from "@/components/MapView";
import { Clock } from "@/components/chrome/Clock";
import { useAmbientGuard } from "@/hooks/use-ambient-guard";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./ambient.module.css";

// Ambient mode ("frame on a wall"): the inert map, a clock, and the 24 h
// guarantees (wake lock, daily reload, outage-recovery reload).
export default function Ambient() {
  const { mode } = useMode(); // auto only; no switcher in ambient
  const fleet = useFleet();
  useAmbientGuard(fleet.feedState);

  return (
    <main className={styles.stage}>
      <MapView mode={mode} fleet={fleet} ambient />
      <div className={styles.clockCorner}>
        <Clock />
      </div>
    </main>
  );
}
