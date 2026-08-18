"use client";

import { useEffect, useState } from "react";
import { autoMode, msToNextModeBoundary, type Mode } from "@/lib/time/sound-time";

export type ModePreference = "auto" | Mode;

/** Mode preference with a live auto boundary timer (the prototype only
 * evaluated auto on click/load - a wall display never re-tinted at sunset).
 * Re-evaluates at each Sound-time boundary and on visibility regain.
 *
 * An explicit preference IS the mode - derived during render, not stored,
 * so a switcher click commits in one render with no wrong-mode frame
 * (rerender-derived-state-no-effect). Only "auto" needs state: the clock
 * tick that moves the day/dusk/night boundary. */
export function useMode() {
  const [pref, setPref] = useState<ModePreference>("auto");
  const [autoTick, setAutoTick] = useState<Mode>(() => autoMode());
  const mode = pref === "auto" ? autoTick : pref;

  useEffect(() => {
    if (pref !== "auto") return;
    // Returning to auto after hours pinned: the stored tick may be stale.
    const refresh = () => setAutoTick(autoMode());
    refresh();

    let timer: number;
    const arm = () => {
      timer = window.setTimeout(() => {
        refresh();
        arm();
      }, msToNextModeBoundary() + 500);
    };
    arm();

    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pref]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  return { mode, pref, setPref };
}
