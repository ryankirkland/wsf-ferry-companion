"use client";

// Orchestrates the four trip documents for one pair + date: index and fares
// once per pair, the day file on date change plus a 5-minute re-poll, alerts
// every minute, everything resynced on visibility regain. Failed fetches
// keep the last good copy (same discipline as the fleet poller).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALERTS_POLL_MS, PAIR_REFRESH_MS } from "@/config";
import { makeTripFetchers } from "@/lib/data/trip-data";
import { soundDate, soundHour, shiftDate } from "@/lib/time/sound-time";
import type { PairEntry } from "@/lib/trip/pairs";
import type { AlertsDoc, PairDay, PairFares, PairsIndex } from "@/lib/trip/types";

export interface TripData {
  index: PairsIndex | null;
  day: PairDay | null;
  /** Yesterday's file when viewing today before 3 AM (post-midnight tail). */
  prevDay: PairDay | null;
  fares: PairFares | null;
  alerts: AlertsDoc | null;
  dayLoading: boolean;
  /** True once the day fetch settled (distinguishes "loading" from "no file"). */
  daySettled: boolean;
}

export function useTripData(pair: PairEntry, date: string): TripData {
  const fetchers = useMemo(() => makeTripFetchers(), []);
  const [index, setIndex] = useState<PairsIndex | null>(null);
  const [fares, setFares] = useState<PairFares | null>(null);
  const [alerts, setAlerts] = useState<AlertsDoc | null>(null);
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

  // Index + fares: once per pair.
  useEffect(() => {
    let alive = true;
    void fetchers.index().then((doc) => alive && doc && setIndex(doc));
    void fetchers.fares(pair.dep, pair.arr).then((doc) => alive && doc && setFares(doc));
    return () => {
      alive = false;
    };
  }, [fetchers, pair.dep, pair.arr]);

  // Day file: on date change, then every PAIR_REFRESH_MS. The first load
  // fires from a 0 ms timer so no setState runs synchronously inside the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const kickoff = window.setTimeout(() => void loadDay(), 0);
    const timer = window.setInterval(() => void loadDay(), PAIR_REFRESH_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [loadDay]);

  // Alerts: every minute.
  useEffect(() => {
    let alive = true;
    const tick = () => void fetchers.alerts().then((doc) => alive && doc && setAlerts(doc));
    tick();
    const timer = window.setInterval(tick, ALERTS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [fetchers]);

  // Visibility regain: resync the volatile documents.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      void loadDay();
      void fetchers.alerts().then((doc) => doc && setAlerts(doc));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchers, loadDay]);

  return {
    index,
    day,
    prevDay,
    fares,
    alerts,
    dayLoading: settledFor !== date,
    daySettled: settledFor === date,
  };
}
