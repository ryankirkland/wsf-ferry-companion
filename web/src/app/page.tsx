"use client";

import { TopBar } from "@/components/chrome/TopBar";
import { useMode } from "@/hooks/use-mode";
import styles from "./page.module.css";

export default function Home() {
  const { pref, setPref } = useMode();

  return (
    <main className={styles.stage}>
      <TopBar pref={pref} onModeChange={setPref} />
      {/* The PaperSoundMap controller mounts here (next PR). */}
      <div className={styles.mapSlot}>
        <p className={styles.placeholder}>
          The Sound is being drawn. The fleet arrives here shortly.
        </p>
      </div>
    </main>
  );
}
