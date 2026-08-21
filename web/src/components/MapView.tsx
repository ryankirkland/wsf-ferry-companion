"use client";

import { useEffect, useRef } from "react";
import { LoadingVeil } from "@/components/chrome/LoadingVeil";
import { RoutePanel } from "@/components/RoutePanel";
import { StalenessBanner } from "@/components/chrome/StalenessBanner";
import { useMapController } from "@/hooks/use-map-controller";
import type { FleetUpdate } from "@/lib/data/fleet-poller";
import type { Mode } from "@/lib/time/sound-time";
import styles from "./map.module.css";

export function MapView({
  mode,
  fleet,
  ambient = false,
  onVesselClick,
}: {
  mode: Mode;
  fleet: FleetUpdate;
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

  useEffect(() => {
    if (fleet.snapshot) controllerRef.current?.applySnapshot(fleet.snapshot.vessels);
  }, [fleet.snapshot, state.ready, controllerRef]);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.map} data-testid="map-container" />
      <LoadingVeil gone={state.ready} failed={state.failed} onRetry={retry} />
      {state.ready && <StalenessBanner feedState={fleet.feedState} lastGoodAt={fleet.lastGoodAt} />}
      {state.ready && !ambient && (
        <RoutePanel
          onChange={(hidden) => controllerRef.current?.setHiddenRoutes(hidden)}
          onOosChange={(hide) => controllerRef.current?.setHideOutOfService(hide)}
        />
      )}
      {state.degraded && (
        <p className={styles.degraded}>Having trouble drawing the Sound - still trying.</p>
      )}
    </div>
  );
}
