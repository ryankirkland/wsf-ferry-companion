"use client";

import { useEffect, useState } from "react";
import { msToNextMinute, soundClock } from "@/lib/time/sound-time";

/** Minute-aligned Sound-time clock: one wake per minute, drift-proof. */
export function useSoundClock(): string {
  const [clock, setClock] = useState(() => soundClock());

  useEffect(() => {
    let timer: number;
    const tick = () => {
      setClock(soundClock());
      timer = window.setTimeout(tick, msToNextMinute());
    };
    timer = window.setTimeout(tick, msToNextMinute());
    return () => clearTimeout(timer);
  }, []);

  return clock;
}
