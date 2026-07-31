"use client";

// The system view: 24 years of Puget Sound ferry departures, and what they
// say. The job here is proportion - the headline number is the least
// interesting thing on the page, because a single percentage over 3.5
// million sailings hides the two stories that matter: this summer is worse
// than the average, and time of year moves reliability more than anything
// a rider controls.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { makeStatsFetchers } from "@/lib/data/stats-data";
import type { StatsSummary } from "@/lib/stats/types";
import {
  formatDelay,
  formatPct,
  formatSampleSize,
  onTimeBand,
} from "@/lib/stats/reliability";
import styles from "./stats.module.css";
import overview from "./overview.module.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function StatsOverview() {
  const fetchers = useMemo(() => makeStatsFetchers(), []);
  const [doc, setDoc] = useState<StatsSummary | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void fetchers.summary().then((d) => {
        if (!alive) return;
        if (d) setDoc(d);
        setSettled(true);
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [fetchers]);

  if (!settled) {
    return <p className={styles.lede}>Loading the record…</p>;
  }
  if (!doc) {
    return (
      <p className={styles.absent}>
        The statistics could not be loaded right now. Nothing is being estimated in their place.
      </p>
    );
  }

  const sup = doc.superlatives;
  const worstMonth = sup.roughest_month;
  const years = doc.by_year.filter((y) => y.ontime_pct !== null);
  const maxYearN = Math.max(...doc.by_year.map((y) => y.n), 1);
  const vessels = [...doc.vessels]
    .filter((v) => v.primary.n >= 200 && v.primary.ontime_pct !== null)
    .sort((a, b) => (b.primary.ontime_pct ?? 0) - (a.primary.ontime_pct ?? 0));

  return (
    <>
      <div className={overview.hero}>
        <div>
          <div
            className={`${overview.heroPct} ${styles[onTimeBand(doc.system.primary.ontime_pct)]}`}
          >
            {formatPct(doc.system.primary.ontime_pct)}
          </div>
          <div className={overview.heroLabel}>
            on time over the {doc.window.label}
            <br />
            <span className={overview.heroSub}>
              {formatSampleSize(doc.system.primary.n)} · typical delay{" "}
              {formatDelay(doc.system.primary.p50)}
            </span>
          </div>
        </div>
        <div className={overview.heroCompare}>
          <div className={overview.heroComparePct}>
            {formatPct(doc.system.all_time.ontime_pct)}
          </div>
          <div className={overview.heroSub}>
            across all {formatSampleSize(doc.system.all_time.n)}
            <br />
            since {doc.coverage.since}
          </div>
        </div>
      </div>

      <p className={styles.lede}>
        On time means leaving within {doc.ontime_definition_min} minutes of schedule. Every figure
        below shows the sailings behind it; where there are too few to mean anything, it says so
        instead of guessing.
      </p>

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>Every year since {doc.coverage.since.slice(0, 4)}</h2>
        {/* 25 labels do not fit a phone: every fifth year carries the
            axis, and the caption below carries the range. */}
        <div className={overview.yearChart} data-testid="year-chart">
          {years.map((y) => (
            <div key={y.year} className={overview.yearCol} title={`${y.year}: ${formatPct(y.ontime_pct)} of ${formatSampleSize(y.n)}`}>
              <div className={overview.yearBarTrack}>
                <div
                  className={`${overview.yearBar} ${styles[onTimeBand(y.ontime_pct)]}`}
                  style={{ height: `${((y.ontime_pct ?? 0) - 50) * 2}%` }}
                />
              </div>
              <div className={overview.yearLabel}>
                {y.year % 5 === 0 ? `'${String(y.year).slice(2)}` : "\u00a0"}
              </div>
            </div>
          ))}
        </div>
        <p className={styles.foot}>
          One bar per year, {doc.coverage.since.slice(0, 4)} to {doc.data_through.slice(0, 4)},
          starting at 50%. Height is the share of departures within{" "}
          {doc.ontime_definition_min} minutes of schedule; the thinnest year still holds{" "}
          {Math.round(Math.min(...doc.by_year.map((y) => y.n)) / 1000)}k sailings, the fullest{" "}
          {Math.round(maxYearN / 1000)}k.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>When the Sound runs late</h2>
        <div className={overview.monthGrid} data-testid="month-grid">
          {doc.by_month.map((m) => (
            <div key={m.month} className={overview.month}>
              <div className={styles.seasonName}>{MONTHS[m.month - 1]?.slice(0, 3)}</div>
              <div className={`${styles.seasonPct} ${styles[onTimeBand(m.ontime_pct)]}`}>
                {formatPct(m.ontime_pct)}
              </div>
            </div>
          ))}
        </div>
        {worstMonth && (
          <p className={styles.foot}>
            {MONTHS[worstMonth.month - 1]} is the hardest month in the record at{" "}
            {formatPct(worstMonth.ontime_pct)} across {formatSampleSize(worstMonth.n)}.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>Routes</h2>
        <div className={overview.cards}>
          {sup.most_punctual_pair && (
            <SuperlativeCard title="Most dependable" pair={sup.most_punctual_pair} window={doc.window.label} />
          )}
          {sup.toughest_pair && (
            <SuperlativeCard title="Toughest" pair={sup.toughest_pair} window={doc.window.label} />
          )}
        </div>
      </section>

      {vessels.length > 0 && (
        <section className={styles.section}>
          <h2 className={`display ${styles.sectionTitle}`}>Boats</h2>
          <p className={styles.lede}>
            Over the {doc.window.label}, boats with at least 200 sailings.
          </p>
          <div className={styles.slots} data-testid="vessel-list">
            {vessels.map((v) => (
              <div key={v.vessel_name} className={styles.slotRow}>
                <span className={styles.slotTime}>{v.vessel_name}</span>
                <span className={`${styles.slotBar} ${styles[onTimeBand(v.primary.ontime_pct)]}`}>
                  <span
                    className={styles.slotBarFill}
                    style={{ width: `${v.primary.ontime_pct ?? 0}%` }}
                  />
                </span>
                <span className={`${styles.slotPct} ${styles[onTimeBand(v.primary.ontime_pct)]}`}>
                  {formatPct(v.primary.ontime_pct)}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.foot}>
            A boat&apos;s record follows the runs it was assigned to, not only how it was driven.
          </p>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>What this covers</h2>
        <p className={styles.absent}>
          {doc.coverage.note}
          <br />
          <br />
          {doc.coverage.thin_days.length > 0 ? (
            <>
              {doc.coverage.thin_days.length} recent day
              {doc.coverage.thin_days.length === 1 ? "" : "s"} came in far below the usual number of
              reported sailings and are flagged rather than averaged in:{" "}
              {doc.coverage.thin_days.map((d) => d.service_date).join(", ")}.
            </>
          ) : (
            "No recent day fell short on reported sailings."
          )}
          <br />
          <br />
          Cancellations have been tracked since {doc.cancellations.tracking_since}.{" "}
          {doc.cancellations.note}
        </p>
        <p className={styles.foot}>
          Updated {doc.generated_at.slice(0, 10)} with sailings through {doc.data_through}.{" "}
          <Link href="/trip" className={overview.link}>
            Look up your own run →
          </Link>
        </p>
      </section>
    </>
  );
}

function SuperlativeCard({
  title,
  pair,
  window,
}: {
  title: string;
  pair: NonNullable<StatsSummary["superlatives"]["most_punctual_pair"]>;
  window: string;
}) {
  const body = (
    <>
      <div className={styles.seasonName}>{title}</div>
      <div className={`${overview.cardPct} ${styles[onTimeBand(pair.ontime_pct)]}`}>
        {formatPct(pair.ontime_pct)}
      </div>
      <div className={overview.cardName}>{pair.name}</div>
      <div className={styles.headlineMeta}>
        {formatSampleSize(pair.n)} in the {window}
      </div>
    </>
  );
  return pair.slug ? (
    <Link href={`/trip/${pair.slug}`} className={overview.card}>
      {body}
    </Link>
  ) : (
    <div className={overview.card}>{body}</div>
  );
}
