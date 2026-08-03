"use client";

import { useEffect, useState } from "react";

/** Re-renders every `intervalMs` so countdown-driven UI (signals, ETAs)
 * keeps ticking without a page reload. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
