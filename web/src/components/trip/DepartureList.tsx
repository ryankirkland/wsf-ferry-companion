"use client";

import { useState } from "react";
import type { CapacitySailing } from "@/lib/stats/types";
import type { GhostCancel } from "@/lib/trip/day";
import type { Signal } from "@/lib/trip/signal";
import type { AlertItem, Sailing } from "@/lib/trip/types";
import { CancelledSlotRow } from "./CancelledSlotRow";
import { DepartureRow } from "./DepartureRow";
import styles from "./trip.module.css";

export interface DepartureItem {
  sailing: Sailing;
  signal: Signal;
  cancelledReason: string | null;
  /** An unmatched cancel names this row's time - see DayView.rowNotes. */
  cancelNote?: string | null;
}

type Row = { kind: "sailing"; item: DepartureItem } | { kind: "ghost"; ghost: GhostCancel };

function rowMs(r: Row): number {
  return r.kind === "sailing" ? r.item.sailing.depart_ms : r.ghost.depart_ms;
}

/** The day's departures with everything before the next boat collapsed -
 * the answer should be the first thing on screen, not a scroll hunt. */
export function DepartureList({
  items,
  nextIndex,
  crossingMin,
  capacity,
  ghosts = [],
  alertForGhost,
  nowMs,
  routePassengerOnly = false,
}: {
  items: DepartureItem[];
  nextIndex: number;
  crossingMin: number | null;
  /** Live drive-up readings keyed by depart_ms - the same instant WSF puts
   *  on both the schedule and the space feed. */
  capacity?: Map<number, CapacitySailing>;
  /** Cancelled slots with no row of their own, interleaved by time. Past
   *  ones collapse with the earlier sailings; a future one always shows,
   *  even ahead of the next real boat - that is the slot a rider is
   *  looking for. The count on the button is sailings only. */
  ghosts?: GhostCancel[];
  alertForGhost?: (ghost: GhostCancel) => AlertItem | null;
  /** The page clock; a ghost slot behind it fades like a departed row. */
  nowMs?: number;
  /** routedetails' whole-route flag; each row also reads its own LoadingRule. */
  routePassengerOnly?: boolean;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const cut = showEarlier ? 0 : Math.max(0, nextIndex);
  const hidden = items.slice(0, cut);
  const visible = items.slice(cut);
  const firstVisibleMs = visible[0]?.sailing.depart_ms ?? Infinity;
  const ghostShown = (g: GhostCancel) =>
    cut === 0 || (nowMs !== undefined ? g.depart_ms >= nowMs : g.depart_ms > firstVisibleMs);
  const rows: Row[] = [
    ...visible.map((item): Row => ({ kind: "sailing", item })),
    ...ghosts.filter(ghostShown).map((ghost): Row => ({ kind: "ghost", ghost })),
  ].sort((a, b) => rowMs(a) - rowMs(b));

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
        {rows.map((row) =>
          row.kind === "sailing" ? (
            <DepartureRow
              key={`${row.item.sailing.vessel_id}-${row.item.sailing.depart_ms}`}
              sailing={row.item.sailing}
              signal={row.item.signal}
              cancelledReason={row.item.cancelledReason}
              cancelNote={row.item.cancelNote ?? null}
              crossingMin={crossingMin}
              capacity={capacity?.get(row.item.sailing.depart_ms) ?? null}
              routePassengerOnly={routePassengerOnly}
            />
          ) : (
            <CancelledSlotRow
              key={`ghost-${row.ghost.depart_ms}`}
              ghost={row.ghost}
              alert={alertForGhost?.(row.ghost) ?? null}
              past={nowMs !== undefined && row.ghost.depart_ms < nowMs}
            />
          ),
        )}
      </ul>
    </div>
  );
}
