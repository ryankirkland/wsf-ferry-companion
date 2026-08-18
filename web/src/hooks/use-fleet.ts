"use client";

import { useEffect, useState } from "react";
import { DATA_MODE } from "@/config";
import { FleetPoller, type FleetUpdate, type PollerLike } from "@/lib/data/fleet-poller";
import { FixturePoller } from "@/lib/data/fixture-poller";

// Returns the poller's state object AS-IS: it only changes identity when a
// poll lands, so consumers (MapView, VesselCard) stay memoizable. The old
// shape spread it with a fresh pollNow closure every render, which made
// every prop new on every render - and nothing ever called pollNow.
export function useFleet(): FleetUpdate {
  const [update, setUpdate] = useState<FleetUpdate>({
    snapshot: null,
    feedState: "down",
    lastGoodAt: null,
  });

  useEffect(() => {
    const poller: PollerLike = process.env.NODE_ENV === "development" && DATA_MODE === "fixture" ? new FixturePoller() : new FleetPoller();
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
    };
  }, []);

  return update;
}
