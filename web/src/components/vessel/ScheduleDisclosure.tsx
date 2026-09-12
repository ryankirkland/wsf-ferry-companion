"use client";

// The vessel card's "Next sailings" disclosure: the toggle row, the
// animated height track, and the scroll box the day schedule lives in.
//
// Its own component, not inline in VesselCard, because its lifecycle has
// to match the DOM it measures. The card only shows this control when the
// boat's current pair is known; a docked boat (arr null) or a boat you
// switch away from must take the open state, the measured height and the
// mounted schedule down with it, not leave `expanded` true in the parent
// with nothing under it. VesselCard keys this on the vessel id, so a
// different boat gets a fresh, closed disclosure and never inherits the
// old schedule for the collapse window - the day last browsed for one
// boat must never bleed into the next one you tap (Ryan's ask).

import dynamic from "next/dynamic";
import { useState } from "react";
import type { FleetUpdate } from "@/lib/data/fleet-poller";
import type { PairEntry } from "@/lib/trip/pairs";
import { useCollapsibleHeight } from "@/hooks/use-collapsible-height";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./vessel-card.module.css";

// The inline schedule pulls the sailing schedule's whole data + signal engine;
// loaded only when the disclosure opens, warmed on card mount (VesselCard)
// so the tap feels instant (bundle-conditional). The loading fallback
// matters even warmed: it's what useCollapsibleHeight has to measure on
// the first frame, so the height reveal starts growing immediately on tap
// instead of sitting dead until the chunk resolves.
const VesselSchedule = dynamic(
  () => import("./VesselSchedule").then((m) => m.VesselSchedule),
  {
    ssr: false,
    loading: () => (
      <div className={styles.scheduleBody}>
        <p className={tripStyles.rangeNote}>Loading sailings…</p>
      </div>
    ),
  },
);

export function ScheduleDisclosure({ pair, fleet }: { pair: PairEntry; fleet: FleetUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const { contentRef, height, render } = useCollapsibleHeight(expanded);
  return (
    <div className={styles.scheduleWrap}>
      <button
        className={styles.tripLink}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        Next sailings: {pair.depName} → {pair.arrName}
        <span className={styles.chevron} aria-hidden>
          {expanded ? "⌃" : "⌄"}
        </span>
      </button>
      <div
        className={styles.scheduleCollapse}
        style={{ height }}
        data-testid="schedule-collapse"
      >
        {/* The measured node is also the scroll box: its max-height caps
            what the observer reports, so the track eases to the visible
            height - never to a taller off-screen one that the cap would
            cut the motion off partway through. */}
        <div ref={contentRef} className={styles.scheduleScroll}>
          {/* Gated on `render`, not `expanded`: `expanded` flips false the
              instant the toggle is clicked closed, but the departure list
              must stay mounted until the height-to-0 transition above has
              actually finished, or it vanishes a third of a second before
              the box around it visibly catches up. */}
          {render && <VesselSchedule entry={pair} fleet={fleet} />}
        </div>
      </div>
    </div>
  );
}
