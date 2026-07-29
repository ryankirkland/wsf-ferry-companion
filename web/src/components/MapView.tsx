"use client";

import { useRef } from "react";
import { LoadingVeil } from "@/components/chrome/LoadingVeil";
import { useMapController } from "@/hooks/use-map-controller";
import type { Mode } from "@/lib/time/sound-time";
import styles from "./map.module.css";

export function MapView({ mode, ambient = false }: { mode: Mode; ambient?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, retry } = useMapController(containerRef, mode, ambient, styles.term!);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} />
      <LoadingVeil gone={state.ready} failed={state.failed} onRetry={retry} />
      {state.degraded && (
        <p className={styles.degraded}>Having trouble drawing the Sound - still trying.</p>
      )}
    </div>
  );
}
