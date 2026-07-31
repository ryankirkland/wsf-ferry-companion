"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "@/components/MapView";
import { TopBar } from "@/components/chrome/TopBar";
import { BoatFab } from "@/components/nav/BoatFab";
import { VesselCard } from "@/components/vessel/VesselCard";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./page.module.css";

export default function Home() {
  const { mode, pref, setPref } = useMode();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const fleet = useFleet();

  // Deep link: trip pages link vessel chips to /?vessel=<id>. Honor it
  // once the fleet is in hand (window.location keeps the static-export
  // page free of a Suspense boundary just for one param).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !fleet.snapshot) return;
    deepLinked.current = true;
    const id = Number(new URLSearchParams(window.location.search).get("vessel"));
    if (id && fleet.snapshot.vessels.some((v) => v.id === id)) {
      const t = window.setTimeout(() => setSelectedId(id), 0);
      return () => window.clearTimeout(t);
    }
  }, [fleet.snapshot]);

  const onVesselClick = useCallback((id: number) => setSelectedId(id), []);
  const selected = useMemo(
    () => fleet.snapshot?.vessels.find((v) => v.id === selectedId) ?? null,
    [fleet.snapshot, selectedId],
  );

  return (
    <main className={styles.stage}>
      <MapView mode={mode} fleet={fleet} onVesselClick={onVesselClick} />
      <TopBar pref={pref} onModeChange={setPref} />
      <BoatFab />
      {selected && <VesselCard fix={selected} onClose={() => setSelectedId(null)} />}
    </main>
  );
}
