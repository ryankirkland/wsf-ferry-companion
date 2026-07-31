"use client";

// The F4 promise on a pair page: "is my usual sailing typically late?"
//
// Answering that honestly means three things happen here and nowhere else:
// the rider's own departure is picked out of 38 slots, every figure states
// the window and sample behind it, and a slot too thin to judge says so in
// words rather than printing a confident number built on four sailings.

import { useState } from "react";
import type { PairStats, SlotStat } from "@/lib/stats/types";
import {
  bestBlock,
  findSlot,
  formatDelay,
  formatPct,
  formatSampleSize,
  formatSlotTime,
  hasAnyStats,
  onTimeBand,
  slotCaveat,
} from "@/lib/stats/reliability";
import styles from "./stats.module.css";

const SEASON_ORDER = ["winter", "spring", "summer", "fall"];
const COLLAPSED_SLOTS = 6;

export function Reliability({
  stats,
  yourSlot,
  settled,
}: {
  stats: PairStats | null;
  /** "HH:MM" of the sailing the rider is looking at, when there is one. */
  yourSlot: string | null;
  settled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!settled && !stats) return null;
  if (!hasAnyStats(stats)) {
    return (
      <section className={styles.section} data-testid="reliability-empty">
        <h2 className={`display ${styles.sectionTitle}`}>Reliability</h2>
        <p className={styles.absent}>
          No sailing history has been recorded for this run yet, so there is nothing honest to say
          about how often it runs on time.
        </p>
      </section>
    );
  }

  const doc = stats!;
  const { block, window } = bestBlock(doc.overall);
  const windowLabel = window === "primary" ? doc.window.label : "all time";
  const band = onTimeBand(block.ontime_pct);
  const slot = findSlot(doc, yourSlot);

  const ranked = doc.slots;
  const shown = expanded ? ranked : ranked.slice(0, COLLAPSED_SLOTS);
  const seasons = [...doc.seasons].sort(
    (a, b) => SEASON_ORDER.indexOf(a.season) - SEASON_ORDER.indexOf(b.season),
  );

  return (
    <section className={styles.section} data-testid="reliability">
      <div className={styles.sectionHead}>
        <h2 className={`display ${styles.sectionTitle}`}>Reliability</h2>
        <span className={styles.windowNote}>{windowLabel}</span>
      </div>
      <p className={styles.lede}>
        On time means leaving within {doc.ontime_definition_min} minutes of schedule.
      </p>

      <div className={styles.headline}>
        <div className={`${styles.bigPct} ${styles[band]}`} data-testid="reliability-headline">
          {formatPct(block.ontime_pct)}
        </div>
        <div className={styles.headlineMeta}>
          of <strong>{formatSampleSize(block.n)}</strong> left on time
          {window === "all_time" && " (no sailings in the recent window)"}.
          <br />
          Typical delay <strong>{formatDelay(block.p50)}</strong>, and{" "}
          <strong>1 in 10</strong> leaves {formatDelay(block.p90)} late or worse.
        </div>
      </div>

      {slot && <YourSailing slot={slot} windowLabel={doc.window.label} />}

      <div className={styles.slots} data-testid="slot-list">
        {shown.map((s) => (
          <SlotRow key={s.hhmm} slot={s} highlight={s.hhmm === yourSlot} />
        ))}
      </div>
      {shown.some((s) => s.basis === "hour") && (
        <p className={styles.caveat} data-testid="hour-legend">
          <span className={styles.slotHourMark}>hour</span> marks a sailing with fewer than{" "}
          {doc.min_slot_sample} departures in this window - it shows the surrounding hour instead.
        </p>
      )}
      {ranked.length > COLLAPSED_SLOTS && (
        <button className={styles.toggle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer sailings" : `Show all ${ranked.length} sailings`}
        </button>
      )}

      {seasons.length > 0 && (
        <div className={styles.seasons} data-testid="seasons">
          {seasons.map((s) => (
            <div key={s.season} className={styles.season}>
              <div className={styles.seasonName}>{s.season}</div>
              <div className={`${styles.seasonPct} ${styles[onTimeBand(s.ontime_pct)]}`}>
                {formatPct(s.ontime_pct)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Cancellations doc={doc} />

      <p className={styles.foot}>
        From {formatSampleSize(doc.overall.all_time.n)} recorded on this run through{" "}
        {doc.data_through}.
      </p>
    </section>
  );
}

function YourSailing({ slot, windowLabel }: { slot: SlotStat; windowLabel: string }) {
  const caveat = slotCaveat(slot, windowLabel);
  const band = onTimeBand(slot.primary.ontime_pct);
  return (
    <div className={styles.yourSlot} data-testid="your-sailing">
      <div className={styles.yourSlotHead}>
        <span className={styles.yourSlotTime}>Your {formatSlotTime(slot.hhmm)} sailing</span>
        <span className={`${styles.slotPct} ${styles[band]}`}>
          {formatPct(slot.primary.ontime_pct)}
        </span>
      </div>
      <div className={styles.headlineMeta}>
        {formatSampleSize(slot.primary.n)} in the {windowLabel} · typical delay{" "}
        {formatDelay(slot.primary.p50)} · 1 in 10 at {formatDelay(slot.primary.p90)} or worse
      </div>
      {caveat && <p className={styles.caveat}>{caveat}</p>}
    </div>
  );
}

function SlotRow({ slot, highlight }: { slot: SlotStat; highlight: boolean }) {
  const pct = slot.primary.ontime_pct;
  const band = onTimeBand(pct);
  return (
    <div
      className={`${styles.slotRow} ${highlight ? styles.slotRowHighlight : ""}`}
      data-testid="slot-row"
      data-basis={slot.basis}
    >
      <span className={styles.slotTime}>{formatSlotTime(slot.hhmm)}</span>
      <span className={`${styles.slotBar} ${styles[band]}`}>
        <span className={styles.slotBarFill} style={{ width: `${pct ?? 0}%` }} />
      </span>
      <span className={`${styles.slotPct} ${styles[band]}`}>
        {formatPct(pct)}
        {slot.basis === "hour" && (
          <span
            className={styles.slotHourMark}
            title={`Fewer than the minimum sailings at this exact time - showing the surrounding hour`}
          >
            hour
          </span>
        )}
      </span>
    </div>
  );
}

function Cancellations({ doc }: { doc: PairStats }) {
  const c = doc.cancellations;
  // A rate over one or two days is noise; the count is still worth stating.
  const days = c.days ?? 0;
  if (!c.window || c.scheduled === 0) {
    return (
      <p className={styles.foot}>
        Cancellations have been tracked since {c.tracking_since}; nothing to report for this run
        yet.
      </p>
    );
  }
  return (
    <p className={styles.foot} data-testid="cancellations">
      {days < 7 ? (
        <>
          Since {c.tracking_since}, <strong>{c.not_sailed}</strong> of {c.scheduled} scheduled
          sailings on this run did not depart ({days} day{days === 1 ? "" : "s"} tracked so far -
          too early for a meaningful rate).
        </>
      ) : (
        <>
          <strong>{formatPct(c.rate_pct)}</strong> of scheduled sailings did not depart over{" "}
          {days} days ({c.not_sailed} of {c.scheduled}).
        </>
      )}{" "}
      Sailings pulled from the schedule in advance are not counted, so treat this as a floor.
    </p>
  );
}
