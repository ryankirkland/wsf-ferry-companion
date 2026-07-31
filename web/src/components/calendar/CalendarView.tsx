"use client";

// The service calendar: WSF's published timeadj feed (tidal cancellations,
// holiday additions) as month grids, season-wide. Days inside the 14-day
// booking horizon link straight to the pair page for that date; deeper
// dates are knowledge, not navigation - upstream can't serve them yet.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { makeTripFetchers } from "@/lib/data/trip-data";
import { buildCalendar, type CalendarDay, type CalendarMonth } from "@/lib/trip/calendar";
import type { AdjustmentEntry, AdjustmentsDoc, PairsIndex } from "@/lib/trip/types";
import { soundDate } from "@/lib/time/sound-time";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./calendar.module.css";

export function CalendarView() {
  const fetchers = useMemo(() => makeTripFetchers(), []);
  const [doc, setDoc] = useState<AdjustmentsDoc | null>(null);
  const [index, setIndex] = useState<PairsIndex | null>(null);
  const [settled, setSettled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchers.adjustments(), fetchers.index()]).then(([a, i]) => {
      if (!alive) return;
      if (a) setDoc(a);
      if (i) setIndex(i);
      setSettled(true);
    });
    return () => {
      alive = false;
    };
  }, [fetchers]);

  const months = useMemo(() => (doc ? buildCalendar(doc) : []), [doc]);
  const today = soundDate();

  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
          <Link href="/trip" className={tripStyles.swap}>
            Trip planner
          </Link>
        </div>

        <h1 className={`display ${tripStyles.pairTitle}`}>Service calendar</h1>
        <p className={styles.lede}>
          Cancellations and added sailings WSF has already published for the season - mostly
          tidal cancellations at Port Townsend / Coupeville. Same-day disruptions appear on trip
          pages as alerts, not here.
        </p>

        {/* Six months of coloured dots with no key: the detail panel
            explains a day you tap, but nothing explained the grid you
            scan. */}
        <p className={styles.legend} data-testid="calendar-legend">
          <span>
            <i className={styles.dotCancel} /> cancelled
          </span>
          <span>
            <i className={styles.dotAdd} /> added sailing
          </span>
          <span className={styles.legendHint}>Tap a highlighted day for the sailings.</span>
        </p>

        {!settled && <p className={tripStyles.rangeNote}>Loading the season…</p>}
        {settled && months.length === 0 && (
          <div className={tripStyles.emptyDay}>
            <h3 className="display">Nothing scheduled</h3>
            <p>No published cancellations or additions right now.</p>
          </div>
        )}

        {months.map((m) => (
          <Month
            key={m.key}
            month={m}
            today={today}
            selected={selected}
            onSelect={(d) => setSelected(d === selected ? null : d)}
            index={index}
          />
        ))}
      </div>
    </main>
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function Month({
  month,
  today,
  selected,
  onSelect,
  index,
}: {
  month: CalendarMonth;
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  index: PairsIndex | null;
}) {
  const selectedDay =
    selected?.slice(0, 7) === month.key
      ? month.weeks.flat().find((d) => d?.date === selected)
      : undefined;

  return (
    <section className={styles.month} data-testid={`month-${month.key}`}>
      <header className={styles.monthHead}>
        <h2 className="display">{month.label}</h2>
        <span className={styles.monthSummary}>
          {month.cancels > 0 && `${month.cancels} cancelled`}
          {month.cancels > 0 && month.adds > 0 && " · "}
          {month.adds > 0 && `${month.adds} added`}
        </span>
      </header>

      <div className={styles.grid} role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={`${w}${i}`} className={styles.weekday} aria-hidden>
            {w}
          </span>
        ))}
        {month.weeks.flat().map((day, i) =>
          day === null ? (
            <span key={`pad${i}`} className={styles.pad} />
          ) : (
            <DayCell
              key={day.date}
              day={day}
              isToday={day.date === today}
              isSelected={day.date === selected}
              onSelect={onSelect}
            />
          ),
        )}
      </div>

      {selectedDay && selectedDay.entries.length > 0 && (
        <DayDetail day={selectedDay} index={index} />
      )}
    </section>
  );
}

function DayCell({
  day,
  isToday,
  isSelected,
  onSelect,
}: {
  day: CalendarDay;
  isToday: boolean;
  isSelected: boolean;
  onSelect: (date: string) => void;
}) {
  const marked = day.entries.length > 0;
  const hasAdd = day.entries.some((e) => e.type === "add");
  const cls = [
    styles.day,
    marked ? styles.dayMarked : "",
    isToday ? styles.dayToday : "",
    isSelected ? styles.daySelected : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!marked) {
    return <span className={cls}>{day.dayNum}</span>;
  }
  return (
    <button className={cls} onClick={() => onSelect(day.date)} aria-label={`${day.date}, ${day.entries.length} scheduled changes`}>
      {day.dayNum}
      <span className={styles.dots} aria-hidden>
        <i className={styles.dotCancel} />
        {hasAdd && <i className={styles.dotAdd} />}
      </span>
    </button>
  );
}

function DayDetail({ day, index }: { day: CalendarDay; index: PairsIndex | null }) {
  return (
    <ul className={styles.detail} data-testid="day-detail">
      {day.entries.map((e, i) => (
        <li key={i}>
          <span className={e.type === "cancel" ? styles.badgeCancel : styles.badgeAdd}>
            {e.type === "cancel" ? "Cancelled" : "Added"}
          </span>
          <span className={styles.detailText}>
            {e.time_local} · {routeLabel(e, index)}
            {e.tidal ? " · tidal" : ""}
          </span>
          <PairLink entry={e} index={index} />
        </li>
      ))}
    </ul>
  );
}

function routeLabel(entry: AdjustmentEntry, index: PairsIndex | null): string {
  const pair = index?.pairs.find(
    (p) => p.route_id === entry.route_id && p.dep === entry.terminal_id,
  );
  if (pair) return `${pair.dep_name} → ${pair.arr_name}`;
  return entry.route_name ?? `Route ${entry.route_id}`;
}

function PairLink({ entry, index }: { entry: AdjustmentEntry; index: PairsIndex | null }) {
  if (!index) return null;
  const pair = index.pairs.find(
    (p) => p.route_id === entry.route_id && p.dep === entry.terminal_id,
  );
  const inHorizon = entry.date >= index.horizon.from && entry.date <= index.horizon.to;
  if (!pair || !inHorizon) return null;
  return (
    <Link className={styles.detailLink} href={`/trip/${pair.slug}?date=${entry.date}`}>
      View sailings
    </Link>
  );
}
