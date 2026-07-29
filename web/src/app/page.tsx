"use client";

import { useCallback, useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { TopBar } from "@/components/chrome/TopBar";
import { VesselCard } from "@/components/vessel/VesselCard";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./page.module.css";

export default function Home() {
  const { mode, pref, setPref } = useMode();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const fleet = useFleet();

  const onVesselClick = useCallback((id: number) => setSelectedId(id), []);
  const selected = useMemo(
    () => fleet.snapshot?.vessels.find((v) => v.id === selectedId) ?? null,
    [fleet.snapshot, selectedId],
  );

  return (
    <main className={styles.stage}>
      <MapView mode={mode} fleet={fleet} onVesselClick={onVesselClick} />
      <TopBar pref={pref} onModeChange={setPref} />
      {selected && <VesselCard fix={selected} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
