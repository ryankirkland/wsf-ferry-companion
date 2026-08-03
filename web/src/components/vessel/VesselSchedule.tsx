"use client";

// Inline day schedule for the vessel card's "Next sailings" expansion -
// the current route's departures for a picked day, reusing F2's day-view
// assembly and signal engine exactly (same data, same rows, same rules).
// Scope is the vessel's CURRENT pair only, never a per-vessel cross-route
// schedule (Ryan's call: see docs/features/realtime-map.md).

import { useMemo, useState } from "react";
import type { FleetUpdate } from "@/lib/data/fleet-poller";
import { useNow } from "@/hooks/use-now";
import { useTripData } from "@/hooks/use-trip-data";
import { buildDayView } from "@/lib/trip/day";
import type { PairEntry } from "@/lib/trip/pairs";
import { computeSignal } from "@/lib/trip/signal";
import { soundDate } from "@/lib/time/sound-time";
import { DateStrip } from "@/components/trip/DateStrip";
import { DepartureList, type DepartureItem } from "@/components/trip/DepartureList";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./vessel-card.module.css";

export function VesselSchedule({ entry, fleet }: { entry: PairEntry; fleet: FleetUpdate }) {
  // Mounted fresh each time a card expands (see VesselCard), so this always
  // starts on today - no stale day carried over from the last boat viewed.
  const [date, setDate] = useState(() => soundDate());
  const now = useNow(30_000);
  const today = soundDate(new Date(now));

  const trip = useTripData(entry, date);

  const dayView = useMemo(() => {
    if (trip.day) return buildDayView(trip.day, trip.prevDay);
    // Just after midnight the server-day can lag ~1 h - yesterday's
    // post-midnight tail is the truth until today's file appears.
    if (trip.prevDay) {
      return buildDayView({ ...trip.prevDay, sailings: [], adjustments: [] }, trip.prevDay);
    }
    return null;
  }, [trip.day, trip.prevDay]);

  const items: DepartureItem[] = useMemo(() => {
    if (!dayView) return [];
    return dayView.sailings.map((sailing) => {
      const fix = fleet.snapshot?.vessels.find((v) => v.id === sailing.vessel_id) ?? null;
      const cancelledReason = dayView.cancelReason.get(sailing.depart_ms) ?? null;
      const signal = computeSignal({
        sailing,
        cancelled: cancelledReason !== null,
        fix,
        depTerminalId: entry.dep,
        nowMs: now,
      });
      return { sailing, signal, cancelledReason };
    });
  }, [dayView, fleet.snapshot, entry.dep, now]);

  const isToday = date === today;
  const nextIndex = items.findIndex(
    (i) => i.cancelledReason === null && i.signal.state !== "departed" && i.signal.state !== "gone",
  );
  const crossingMin = trip.day?.crossing_min ?? null;

  return (
    <div className={styles.scheduleBody} data-testid="vessel-schedule">
      <DateStrip today={today} selected={date} onSelect={setDate} />

      {dayView && dayView.dayNotes.length > 0 && (
        <ul className={tripStyles.dayNotes}>
          {dayView.dayNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {!trip.daySettled && !dayView && <p className={tripStyles.rangeNote}>Loading sailings…</p>}

      {trip.daySettled && items.length === 0 && (
        <p className={tripStyles.rangeNote} data-testid="schedule-empty">
          No sailings this day.
        </p>
      )}

      {items.length > 0 && (
        <DepartureList
          items={items}
          nextIndex={isToday ? Math.max(nextIndex, 0) : 0}
          crossingMin={crossingMin}
        />
      )}
    </div>
  );
}
