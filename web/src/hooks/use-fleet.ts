"use client";

import { useEffect, useRef, useState } from "react";
import { DATA_MODE } from "@/config";
import { FleetPoller, type FleetUpdate, type PollerLike } from "@/lib/data/fleet-poller";
import { FixturePoller } from "@/lib/data/fixture-poller";

export function useFleet(): FleetUpdate & { pollNow: () => void } {
  const pollerRef = useRef<PollerLike | null>(null);
  const [update, setUpdate] = useState<FleetUpdate>({
    snapshot: null,
    feedState: "down",
    lastGoodAt: null,
  });

  useEffect(() => {
    const poller: PollerLike = DATA_MODE === "fixture" ? new FixturePoller() : new FleetPoller();
    pollerRef.current = poller;
    const off = poller.subscribe(setUpdate);
    poller.start();

    // Visibility regain: resync immediately (browsers throttle hidden tabs).
    const onVisible = () => {
      if (!document.hidden) poller.pollNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      off();
      poller.stop();
      pollerRef.current = null;
    };
  }, []);

  return { ...update, pollNow: () => pollerRef.current?.pollNow() };
}
