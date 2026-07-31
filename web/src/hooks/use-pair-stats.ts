"use client";

// Pair reliability + drive-up capacity for one pair. Stats are nightly, so
// they load once and refresh hourly; capacity is minute-fresh and polls,
// resyncing on visibility regain like every other live surface here.

import { useEffect, useMemo, useState } from "react";
import { CAPACITY_POLL_MS, STATS_REFRESH_MS } from "@/config";
import { makeStatsFetchers } from "@/lib/data/stats-data";
import type { CapacityDoc, PairStats } from "@/lib/stats/types";

export interface PairStatsData {
  stats: PairStats | null;
  capacity: CapacityDoc | null;
  /** True once the stats fetch settled - separates "loading" from "none". */
  settled: boolean;
}

export function usePairStats(dep: number, arr: number): PairStatsData {
  const fetchers = useMemo(() => makeStatsFetchers(), []);
  const [stats, setStats] = useState<PairStats | null>(null);
  const [capacity, setCapacity] = useState<CapacityDoc | null>(null);
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const key = `${dep}-${arr}`;

  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchers.pair(dep, arr).then((doc) => {
        if (!alive) return;
        if (doc) setStats(doc);
        else setStats((last) => (last?.pair.dep === dep && last.pair.arr === arr ? last : null));
        setSettledFor(`${dep}-${arr}`);
      });
    const kickoff = window.setTimeout(load, 0);
    const timer = window.setInterval(load, STATS_REFRESH_MS);
    return () => {
      alive = false;
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [fetchers, dep, arr]);

  useEffect(() => {
    let alive = true;
    const tick = () => void fetchers.capacity().then((doc) => alive && doc && setCapacity(doc));
    const kickoff = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, CAPACITY_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchers]);

  return { stats, capacity, settled: settledFor === key };
}
