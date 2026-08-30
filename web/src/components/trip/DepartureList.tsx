"use client";

import { useState } from "react";
import type { CapacitySailing } from "@/lib/stats/types";
import type { Signal } from "@/lib/trip/signal";
import type { Sailing } from "@/lib/trip/types";
import { DepartureRow } from "./DepartureRow";
import styles from "./trip.module.css";

export interface DepartureItem {
  sailing: Sailing;
  signal: Signal;
  cancelledReason: string | null;
}

/** The day's departures with everything before the next boat collapsed -
 * the answer should be the first thing on screen, not a scroll hunt. */
export function DepartureList({
  items,
  nextIndex,
  crossingMin,
  capacity,
}: {
  items: DepartureItem[];
  nextIndex: number;
  crossingMin: number | null;
  /** Live drive-up readings keyed by depart_ms - the same instant WSF puts
   *  on both the schedule and the space feed. */
  capacity?: Map<number, CapacitySailing>;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const cut = showEarlier ? 0 : Math.max(0, nextIndex);
  const hidden = items.slice(0, cut);
  const visible = items.slice(cut);

  return (
    <div>
      {hidden.length > 0 && (
        <button className={styles.earlier} onClick={() => setShowEarlier(true)}>
          Show {hidden.length} earlier sailing{hidden.length === 1 ? "" : "s"}
        </button>
      )}
      {showEarlier && hidden.length === 0 && cut === 0 && items.length > 0 && (
        <button className={styles.earlier} onClick={() => setShowEarlier(false)}>
          Hide earlier sailings
        </button>
      )}
      <ul className={styles.list} data-testid="departures">
        {visible.map((item) => (
          <DepartureRow
            key={`${item.sailing.vessel_id}-${item.sailing.depart_ms}`}
            sailing={item.sailing}
            signal={item.signal}
            cancelledReason={item.cancelledReason}
            crossingMin={crossingMin}
            capacity={capacity?.get(item.sailing.depart_ms) ?? null}
          />
        ))}
      </ul>
    </div>
  );
}
