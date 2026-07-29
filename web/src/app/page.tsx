"use client";

import { MapView } from "@/components/MapView";
import { TopBar } from "@/components/chrome/TopBar";
import { useMode } from "@/hooks/use-mode";
import styles from "./page.module.css";

export default function Home() {
  const { mode, pref, setPref } = useMode();

  return (
    <main className={styles.stage}>
      <MapView mode={mode} />
      <TopBar pref={pref} onModeChange={setPref} />
    </main>
  );
}
