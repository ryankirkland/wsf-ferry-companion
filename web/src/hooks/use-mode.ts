"use client";

import { useEffect, useState } from "react";
import { autoMode, msToNextModeBoundary, type Mode } from "@/lib/time/sound-time";

export type ModePreference = "auto" | Mode;

/** Mode preference with a live auto boundary timer (the prototype only
 * evaluated auto on click/load - a wall display never re-tinted at sunset).
 * Re-evaluates at each Sound-time boundary and on visibility regain. */
export function useMode() {
  const [pref, setPref] = useState<ModePreference>("auto");
  const [mode, setMode] = useState<Mode>(() => autoMode());

  useEffect(() => {
    const apply = () => setMode(pref === "auto" ? autoMode() : pref);
    apply();
    if (pref !== "auto") return;

    let timer: number;
    const arm = () => {
      timer = window.setTimeout(() => {
        apply();
        arm();
      }, msToNextModeBoundary() + 500);
    };
    arm();

    const onVisible = () => {
      if (!document.hidden) apply();
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
