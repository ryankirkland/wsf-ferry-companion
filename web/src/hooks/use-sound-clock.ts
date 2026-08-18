"use client";

import { useSyncExternalStore } from "react";
import { msToNextMinute, soundClock } from "@/lib/time/sound-time";

// Minute-aligned Sound-time clock: one wake per minute, drift-proof.
//
// useSyncExternalStore rather than useState(soundClock()): the static
// export prerenders each page at BUILD time, so a useState initializer
// baked the build machine's clock into the HTML. Every visitor then
// hydrated against a stale time string and React threw #418 (text
// mismatch) on the landing page. This hook renders a stable placeholder
// on the server and swaps in the real time immediately after hydration -
// the documented pattern for values the server cannot know.

const SERVER_PLACEHOLDER = "--:--";

let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    const tick = () => {
      listeners.forEach((l) => l());
      timer = setTimeout(tick, msToNextMinute());
    };
    timer = setTimeout(tick, msToNextMinute());
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearTimeout(timer);
  };
}

export function useSoundClock(): string {
  return useSyncExternalStore(subscribe, soundClock, () => SERVER_PLACEHOLDER);
}
