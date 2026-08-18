"use client";

// The day file for one pair + date: fetch on date change, re-poll every
// PAIR_REFRESH_MS, resync on visibility regain. Split out of useTripData
// (rerender-split-combined-hooks): the vessel card's inline schedule needs
// exactly this and nothing else - consuming the combined hook there fired
// index/fares fetches nobody rendered and started a permanent 60 s alerts
// poll from a map-page disclosure toggle.

import { useCallback, useEffect, useRef, useState } from "react";
import { PAIR_REFRESH_MS } from "@/config";
import { makeTripFetchers, type TripFetchers } from "@/lib/data/trip-data";
import { soundDate, soundHour, shiftDate } from "@/lib/time/sound-time";
import type { PairEntry } from "@/lib/trip/pairs";
import type { PairDay } from "@/lib/trip/types";

export interface PairDayData {
  day: PairDay | null;
  /** Yesterday's file when viewing today before 3 AM (post-midnight tail). */
  prevDay: PairDay | null;
  dayLoading: boolean;
  /** True once the day fetch settled (distinguishes "loading" from "no file"). */
  daySettled: boolean;
  /** Imperative resync for composing hooks' visibility handlers. */
  reloadDay: () => void;
}

export function usePairDay(
  pair: PairEntry,
  date: string,
  sharedFetchers?: TripFetchers,
): PairDayData {
  const fetchers = useRef(sharedFetchers ?? makeTripFetchers()).current;
  const [day, setDay] = useState<PairDay | null>(null);
  const [prevDay, setPrevDay] = useState<PairDay | null>(null);
  // Loading/settled are derived from which date last finished fetching -
  // no synchronous setState in effects, and background re-polls of the
  // same date never flash a loading state.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const generation = useRef(0);

  const loadDay = useCallback(async () => {
    const gen = ++generation.current;
    const wantPrev = date === soundDate() && soundHour() < 3;
    const [d, p] = await Promise.all([
      fetchers.day(pair.dep, pair.arr, date),
      wantPrev ? fetchers.day(pair.dep, pair.arr, shiftDate(date, -1)) : Promise.resolve(null),
    ]);
    if (gen !== generation.current) return; // a newer request superseded us
    if (d) setDay(d);
    else setDay((last) => (last?.service_date === date ? last : null));
    setPrevDay(p);
    setSettledFor(date);
  }, [fetchers, pair.dep, pair.arr, date]);

  // On date change, then every PAIR_REFRESH_MS. The first load fires from a
  // 0 ms timer so no setState runs synchronously inside the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadDay(), 0);
    const timer = window.setInterval(() => void loadDay(), PAIR_REFRESH_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [loadDay]);

  // Visibility regain: resync (browsers throttle hidden tabs).
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void loadDay();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadDay]);

  return {
    day,
    prevDay,
    dayLoading: settledFor !== date,
    daySettled: settledFor === date,
    reloadDay: useCallback(() => void loadDay(), [loadDay]),
  };
}
