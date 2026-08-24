"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingVeil } from "@/components/chrome/LoadingVeil";
import { TopBar } from "@/components/chrome/TopBar";
import { BoatFab } from "@/components/nav/BoatFab";
import { useFleet } from "@/hooks/use-fleet";
import { useMode } from "@/hooks/use-mode";
import styles from "./page.module.css";

// maplibre-gl is ~1.26 MB. Statically imported, it sat in this client
// page's initial chunk set and React could not hydrate the page's only
// nav control (BoatFab) until it downloaded and parsed
// (bundle-dynamic-imports). Dynamic keeps the same loading visual - the
// veil - while the map chunk streams in behind an interactive page.
//
// The import is kicked off at MODULE scope, not left to first render.
// next/dynamic otherwise waits for the component to render, which waits
// for hydration: measured 2026-08-23 on a throttled phone, the map chunk
// was not even REQUESTED until ~2,000 ms, and first-boat landed at ~12 s.
// /ambient, which imports the map statically, requested it at ~300 ms and
// beat this page by a full second despite shipping more code - the cost
// was never the bytes, it was discovering them late. Starting the fetch
// as this module evaluates gets it going while React is still hydrating,
// and the veil still covers the gap.
const mapViewModule = import("@/components/MapView");

const MapView = dynamic(() => mapViewModule.then((m) => m.MapView), {
  ssr: false,
  loading: () => <LoadingVeil gone={false} />,
});

// Reached only via a marker click, and it drags the trip engine with it;
// preloaded on idle below so the first click still feels instant
// (bundle-conditional + bundle-preload).
const VesselCard = dynamic(
  () => import("@/components/vessel/VesselCard").then((m) => m.VesselCard),
  { ssr: false },
);

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

  // Warm the vessel-card chunk once the page is idle: the click that needs
  // it must never wait on the network. Optional-chained because older
  // Safari lacks requestIdleCallback; the timer path covers it.
  useEffect(() => {
    const preload = () => void import("@/components/vessel/VesselCard");
    const idleId = window.requestIdleCallback?.(preload);
    if (idleId !== undefined) return () => window.cancelIdleCallback(idleId);
    const t = window.setTimeout(preload, 2500);
    return () => window.clearTimeout(t);
  }, []);

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
      {selected && (
        <VesselCard fix={selected} fleet={fleet} onClose={() => setSelectedId(null)} />
      )}
    </main>
  );
}
