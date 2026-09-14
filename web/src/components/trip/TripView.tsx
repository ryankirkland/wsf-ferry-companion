"use client";

// The trip page orchestrator: four documents (index/day/fares/alerts) +
// the live fleet snapshot -> answer line, departures with signals, fares,
// date strip. All joins are client-side per ADR-0005; the fleet join is
// the verified (VesselID, depart_ms) key inside computeSignal, and live
// drive-up space joins onto the same departures by depart_ms (both sides
// carry WSF's own scheduled departure instant).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CAPACITY_STALE_MS, TRIP_HORIZON_DAYS } from "@/config";
import { useFleet } from "@/hooks/use-fleet";
import { useNow } from "@/hooks/use-now";
import { usePairStats } from "@/hooks/use-pair-stats";
import { useMode } from "@/hooks/use-mode";
import { useTripData } from "@/hooks/use-trip-data";
import { makeTripFetchers } from "@/lib/data/trip-data";
import { buildDayView, type GhostCancel } from "@/lib/trip/day";
import { PAIRS } from "@/lib/trip/pairs";
import { computeSignal } from "@/lib/trip/signal";
import { alertForSlot } from "@/lib/trip/slot-alert";
import type { AlertItem, Sailing } from "@/lib/trip/types";
import { writeStorage, YOUR_RUN_KEY } from "@/lib/storage";
import { shiftDate, soundDate, soundTimeShort } from "@/lib/time/sound-time";
import { TerminalWeather } from "@/components/weather/TerminalWeather";
import { Reliability } from "@/components/stats/Reliability";
import { capacityFor, indexCapacity, slotKeyFor } from "@/lib/stats/reliability";
import { AlertBanner } from "./AlertBanner";
import { AnswerLine } from "./AnswerLine";
import { DateStrip } from "./DateStrip";
import { DepartureList, type DepartureItem } from "./DepartureList";
import { DriveUpNote, hasDriveUpCount } from "./DriveUp";
import { FaresPanel } from "./FaresPanel";
import styles from "./trip.module.css";

export function TripView({ slug }: { slug: string }) {
  useMode(); // keeps the Sound-time day/dusk/night stamp alive on this page
  const entry = PAIRS[slug]!; // the server page 404s unknown slugs
  const router = useRouter();
  const params = useSearchParams();
  const now = useNow(30_000);
  const today = soundDate(new Date(now));

  // ?date= bounded to [today, today+13]; anything else shows today + a note.
  const requested = params.get("date");
  const maxDate = shiftDate(today, TRIP_HORIZON_DAYS - 1);
  const inRange = requested !== null && requested >= today && requested <= maxDate;
  const date = inRange ? requested : today;
  const rangeNote =
    requested !== null && !inRange
      ? requested < today
        ? "Past sailings aren't browsable - showing today."
        : `Schedules are published ${TRIP_HORIZON_DAYS} days out - showing today.`
      : null;

  const trip = useTripData(entry, date);
  const fleet = useFleet();
  const stats = usePairStats(entry.dep, entry.arr);

  // Remember this as "your run" for the picker.
  useEffect(() => {
    writeStorage(YOUR_RUN_KEY, slug);
  }, [slug]);

  const dayView = useMemo(() => {
    if (trip.day) return buildDayView(trip.day, trip.prevDay);
    // Just after midnight the upstream server-day can lag ~1 h, so today's
    // file may not exist yet - yesterday's post-midnight tail is the truth.
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
      return {
        sailing,
        signal,
        cancelledReason,
        cancelNote: dayView.rowNotes.get(sailing.depart_ms) ?? null,
      };
    });
  }, [dayView, fleet.snapshot, entry.dep, now]);

  // Drive-up space for THIS run, keyed by departure. The feed is
  // current-state only, so it speaks about today and only today - a future
  // date shows no space at all rather than today's lot under tomorrow's
  // sailings (the list and the note are both gated on isToday below).
  const capacityView = useMemo(
    () => capacityFor(stats.capacity, entry.dep, entry.arr, now, CAPACITY_STALE_MS),
    [stats.capacity, entry.dep, entry.arr, now],
  );
  const capacityBySailing = useMemo(
    () => indexCapacity(capacityView.sailings ?? []),
    [capacityView],
  );

  // How many cards will actually print a number. The note says "none of the
  // sailings above are showing space" instead of stamping a reading time over
  // a page with no numbers on it - see DriveUp.tsx.
  const driveUpShown = useMemo(
    () =>
      items.filter(
        (i) =>
          i.cancelledReason === null &&
          i.signal.state !== "departed" &&
          i.signal.state !== "gone" &&
          hasDriveUpCount(capacityBySailing.get(i.sailing.depart_ms)),
      ).length,
    [items, capacityBySailing],
  );

  const nextIndex = items.findIndex(
    (i) => i.cancelledReason === null && i.signal.state !== "departed" && i.signal.state !== "gone",
  );
  const isToday = date === today;
  const next = isToday && nextIndex >= 0 ? items[nextIndex]! : null;

  // Which departure "your sailing" means: the next one today, or the first
  // of the day when browsing ahead. Slot identity is Sound-local HH:MM,
  // exactly how the stats contract keys it.
  const focusMs = next?.sailing.depart_ms ?? (!isToday ? items[0]?.sailing.depart_ms : undefined);
  const yourSlot = focusMs !== undefined ? slotKeyFor(focusMs) : null;
  const exhausted = trip.daySettled && (items.length === 0 || (isToday && nextIndex === -1));

  const indexPair = trip.index?.pairs.find((p) => p.dep === entry.dep && p.arr === entry.arr) ?? null;
  const crossingMin = trip.day?.crossing_min ?? indexPair?.crossing_min ?? null;
  const routeId = indexPair?.route_id ?? null;
  const matchedAlerts = useMemo(
    () =>
      (trip.alerts?.alerts ?? []).filter(
        (a) => a.all_routes || (routeId !== null && a.route_ids.includes(routeId)),
      ),
    [trip.alerts, routeId],
  );

  // Cancelled slots WSF already removed from the schedule link to the
  // bulletin that explains them, when one mentions the slot (or the tide).
  const alertForGhost = useCallback(
    (ghost: GhostCancel) => alertForSlot(ghost, matchedAlerts),
    [matchedAlerts],
  );

  const setDate = (d: string) =>
    router.replace(d === today ? `/trip/${slug}` : `/trip/${slug}?date=${d}`, { scroll: false });

  // The page shell (masthead, h1) is server-rendered by trip/[pair]/page.tsx
  // so the static export carries a real document body; this component owns
  // everything below it, which all depends on ?date= or fetched documents.
  return (
    <>
        <div className={styles.pairMeta}>
          {entry.mate && (
            <Link href={`/trip/${entry.mate}`} className={styles.swap}>
              ⇄ {entry.arrName} → {entry.depName}
            </Link>
          )}
          {/* Crossing time is not badged here: every row already says
              "~ arrives". Reservations link straight to WSF's Save A Spot -
              the bare word "Reservations" read as a mystery badge (owner,
              2026-09-13). Passenger-only rides on the rows it applies to
              (DepartureRow), never over the whole day. */}
          {indexPair?.reservable && (
            <a
              href="https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/default.aspx"
              className={styles.swap}
              target="_blank"
              rel="noopener noreferrer"
            >
              Reserve a vehicle spot ↗
            </a>
          )}
          {indexPair?.route_id != null && (
            <Link href={`/alerts?dep=${entry.dep}&arr=${entry.arr}`} className={styles.swap}>
              Get alerts for this run
            </Link>
          )}
        </div>

        <AlertBanner alerts={matchedAlerts} />
        <AnswerLine next={next} />
        {/* Portals conditions chips onto the h1's terminal names - both
            ends at the viewed sailing's hour; today with nothing left
            still shows now. Outside the forecast horizon the slots stay
            empty (honest absence); only a stale note renders here. */}
        <TerminalWeather
          dep={entry.dep}
          arr={entry.arr}
          atMs={focusMs ?? (isToday ? now : null)}
          nowMs={now}
        />

        {rangeNote && <p className={styles.rangeNote}>{rangeNote}</p>}

        {!trip.daySettled && !dayView && <p className={styles.rangeNote}>Loading sailings…</p>}

        {exhausted ? (
          <EmptyDay
            entry={entry}
            date={date}
            isToday={isToday}
            items={items}
            ghosts={dayView?.ghosts ?? []}
            alertForGhost={alertForGhost}
            nowMs={now}
            crossingMin={crossingMin}
            onTomorrow={() => setDate(shiftDate(today, 1))}
          />
        ) : (
          items.length > 0 && (
            <DepartureList
              items={items}
              nextIndex={isToday ? Math.max(nextIndex, 0) : 0}
              crossingMin={crossingMin}
              capacity={isToday ? capacityBySailing : undefined}
              routePassengerOnly={indexPair?.passenger_only ?? false}
              ghosts={dayView?.ghosts}
              alertForGhost={alertForGhost}
              nowMs={now}
            />
          )
        )}

        {/* What the drive-up numbers on those cards mean, and - when there
            are none - which absence is the true one. Only today: the feed
            has nothing to say about a future date. */}
        {isToday && !exhausted && items.length > 0 && (
          <DriveUpNote
            view={capacityView}
            depName={entry.depName}
            nowMs={now}
            shown={driveUpShown}
          />
        )}

        <DateStrip today={today} selected={date} onSelect={setDate} />

        <Reliability stats={stats.stats} yourSlot={yourSlot} settled={stats.settled} />

        {trip.fares && <FaresPanel fares={trip.fares} viewDate={date} />}

        <p className={styles.footNote}>
          Times are Puget Sound local. Live positions update every few seconds; schedule data
          refreshes within minutes of WSF publishing a change.
        </p>
    </>
  );
}

/** No boats left (or none scheduled): say so plainly and preview tomorrow. */
function EmptyDay({
  entry,
  date,
  isToday,
  items,
  ghosts,
  alertForGhost,
  nowMs,
  crossingMin,
  onTomorrow,
}: {
  entry: (typeof PAIRS)[string];
  date: string;
  isToday: boolean;
  items: DepartureItem[];
  ghosts: GhostCancel[];
  alertForGhost: (ghost: GhostCancel) => AlertItem | null;
  nowMs: number;
  crossingMin: number | null;
  onTomorrow: () => void;
}) {
  const [peek, setPeek] = useState<Sailing[] | null>(null);

  useEffect(() => {
    if (!isToday) return;
    const fetchers = makeTripFetchers();
    let alive = true;
    void fetchers.day(entry.dep, entry.arr, shiftDate(date, 1)).then((doc) => {
      if (alive && doc) setPeek(doc.sailings.filter((s) => !s.after_midnight).slice(0, 3));
    });
    return () => {
      alive = false;
    };
  }, [entry.dep, entry.arr, date, isToday]);

  return (
    <div>
      {/* Ghosts render even with no sailings: a day WSF cancelled outright
          must still list what it cancelled, not just say "no sailings". */}
      {(items.length > 0 || ghosts.length > 0) && (
        <DepartureList
          items={items}
          nextIndex={items.length}
          crossingMin={crossingMin}
          ghosts={ghosts}
          alertForGhost={alertForGhost}
          nowMs={nowMs}
        />
      )}
      <div className={styles.emptyDay} data-testid="empty-day">
        <h3 className="display">{items.length > 0 ? "No more sailings today" : "No sailings this day"}</h3>
        {isToday && peek && peek.length > 0 && (
          <>
            <p>Tomorrow starts:</p>
            <div className={styles.tomorrowPeek}>
              {peek.map((s) => (
                <span key={s.depart_ms}>
                  {soundTimeShort(s.depart_ms)} · {s.vessel}
                </span>
              ))}
            </div>
          </>
        )}
        {isToday && (
          <p>
            <button className={styles.allFares} onClick={onTomorrow}>
              {"See tomorrow's schedule"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
