"use client";

// Orchestrates the four trip documents for one pair + date: index and fares
// once per pair, the day file via usePairDay (its own hook so the vessel
// card can consume just that slice), alerts every minute, everything
// resynced on visibility regain. Failed fetches keep the last good copy
// (same discipline as the fleet poller).

import { useEffect, useMemo, useState } from "react";
import { ALERTS_POLL_MS } from "@/config";
import { usePairDay } from "@/hooks/use-pair-day";
import { makeTripFetchers } from "@/lib/data/trip-data";
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
  const { day, prevDay, dayLoading, daySettled } = usePairDay(pair, date, fetchers);

  // Index + fares: once per pair.
  useEffect(() => {
    let alive = true;
    void fetchers.index().then((doc) => alive && doc && setIndex(doc));
    void fetchers.fares(pair.dep, pair.arr).then((doc) => alive && doc && setFares(doc));
    return () => {
      alive = false;
    };
  }, [fetchers, pair.dep, pair.arr]);

  // Alerts: every minute, plus a resync on visibility regain (the day file's
  // own resync lives inside usePairDay).
  useEffect(() => {
    let alive = true;
    const tick = () => void fetchers.alerts().then((doc) => alive && doc && setAlerts(doc));
    tick();
    const timer = window.setInterval(tick, ALERTS_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchers]);

  return { index, day, prevDay, fares, alerts, dayLoading, daySettled };
}
