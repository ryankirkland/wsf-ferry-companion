"use client";

import { useEffect, useRef } from "react";
import { LoadingVeil } from "@/components/chrome/LoadingVeil";
import { StalenessBanner } from "@/components/chrome/StalenessBanner";
import { useFleet } from "@/hooks/use-fleet";
import { useMapController } from "@/hooks/use-map-controller";
import type { Mode } from "@/lib/time/sound-time";
import styles from "./map.module.css";

export function MapView({
  mode,
  ambient = false,
  onVesselClick,
}: {
  mode: Mode;
  ambient?: boolean;
  onVesselClick?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { controllerRef, state, retry } = useMapController(
    containerRef,
    mode,
    ambient,
    styles.term!,
    styles.vm!,
    onVesselClick,
  );
  const fleet = useFleet();

  useEffect(() => {
    if (fleet.snapshot) controllerRef.current?.applySnapshot(fleet.snapshot.vessels);
  }, [fleet.snapshot, state.ready, controllerRef]);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} data-testid="map-container" />
      <LoadingVeil gone={state.ready} failed={state.failed} onRetry={retry} />
      {state.ready && <StalenessBanner feedState={fleet.feedState} lastGoodAt={fleet.lastGoodAt} />}
      {state.degraded && (
        <p className={styles.degraded}>Having trouble drawing the Sound - still trying.</p>
      )}
    </div>
  );
}
