"use client";

// The 24-hour-wall-tablet guarantees (PRD F1 ambient acceptance):
// - screen wake lock, re-acquired on visibility regain (locks release on hide)
// - daily reload at 04:10 Sound time (fleet quiet hour) - deliberate
//   humility: GL drivers leak; nightly reload turns "slow leak over weeks"
//   into "provably fresh every day"
// - reload on recovery after a >5 min feed outage - the bluntest correct
//   instrument for an unattended display (also clears tile-cache gaps)
// - ?debug=mem: memory + DOM stats to console every 5 min for soak runs

import { useEffect, useRef } from "react";
import type { FeedState } from "@/lib/data/types";
import { SOUND_TZ } from "@/config";

function msToNextReload(): number {
  const now = new Date();
  const sound = new Date(now.toLocaleString("en-US", { timeZone: SOUND_TZ }));
  const target = new Date(sound);
  target.setHours(4, 10, 0, 0);
  if (target <= sound) target.setDate(target.getDate() + 1);
  return target.getTime() - sound.getTime();
}

export function useAmbientGuard(feedState: FeedState): void {
  const downSince = useRef<number | null>(null);

  // Wake lock (best effort - kiosk tablets usually pin the screen anyway).
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* unsupported or denied - kiosk mode covers it */
      }
    };
    void acquire();
    const onVisible = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Daily 04:10 reload.
  useEffect(() => {
    const timer = window.setTimeout(() => location.reload(), msToNextReload());
    return () => clearTimeout(timer);
  }, []);

  // Reload on recovery from a long outage.
  useEffect(() => {
    if (feedState === "down") {
      downSince.current ??= Date.now();
    } else if (feedState === "live" && downSince.current !== null) {
      const outageMs = Date.now() - downSince.current;
      downSince.current = null;
      if (outageMs > 5 * 60_000) location.reload();
    }
  }, [feedState]);

  // Soak instrumentation.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("debug")) return;
    const timer = window.setInterval(() => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      console.log(
        `[soak] heap=${mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + "MB" : "n/a"}`,
        `markers=${document.querySelectorAll("[data-vessel]").length}`,
        `nodes=${document.getElementsByTagName("*").length}`,
      );
    }, 300_000);
    return () => clearInterval(timer);
  }, []);
}
