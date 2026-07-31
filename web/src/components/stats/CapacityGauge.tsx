"use client";

// F5: drive-up space for the next few departures on this run.
//
// Only 13 of 21 terminals publish this, and 23 of 38 pairs ever carry it,
// so the absent case is the common case and gets real copy - "this terminal
// does not report drive-up space" - never an empty gauge that reads as
// "full". Levels are WSF's own green/yellow/red judgment passed through;
// we do not compute a percentage, because reservable inventory is a
// separate pool we cannot see.

import { CAPACITY_STALE_MS } from "@/config";
import { capacityFor } from "@/lib/stats/reliability";
import type { CapacityDoc, CapacitySailing } from "@/lib/stats/types";
import { soundStamp, soundTimeShort } from "@/lib/time/sound-time";
import styles from "./stats.module.css";

const LEVEL_CLASS = {
  plenty: styles.levelPlenty,
  filling: styles.levelFilling,
  full: styles.levelFull,
} as const;

// Only the levels that change what a driver would do get a word; "plenty"
// needs no adjective, and adding one ("90 spaces, plenty") just pads it.
const LEVEL_WORD = { plenty: null, filling: "filling up", full: "nearly full" } as const;
const MAX_ROWS = 4;

export function CapacityGauge({
  capacity,
  dep,
  arr,
  depName,
  nowMs,
}: {
  capacity: CapacityDoc | null;
  dep: number;
  arr: number;
  depName: string;
  nowMs: number;
}) {
  const view = capacityFor(capacity, dep, arr, nowMs, CAPACITY_STALE_MS);

  if (!capacity) return null;

  // "This terminal never reports" is a claim about the terminal, and it is
  // only true when other terminals ARE reporting. Overnight the whole feed
  // returns nothing, and saying Bainbridge does not publish space would be
  // false - it publishes all day.
  if (view.feedQuiet) {
    return (
      <section className={styles.section} data-testid="capacity-quiet">
        <h2 className={`display ${styles.sectionTitle}`}>Drive-up space</h2>
        <p className={styles.absent}>
          WSF is not publishing drive-up space for any terminal right now. It usually returns
          during service hours.
        </p>
      </section>
    );
  }

  if (!view.reporting) {
    return (
      <section className={styles.section} data-testid="capacity-absent">
        <h2 className={`display ${styles.sectionTitle}`}>Drive-up space</h2>
        <p className={styles.absent}>
          {depName} does not report drive-up space to WSF, so there is nothing to show here. That is
          a gap in the published data, not a sign the lot is full.
        </p>
      </section>
    );
  }

  const sailings = (view.sailings ?? []).slice(0, MAX_ROWS);

  return (
    <section className={styles.section} data-testid="capacity">
      <div className={styles.sectionHead}>
        <h2 className={`display ${styles.sectionTitle}`}>Drive-up space</h2>
        {view.asOfMs !== null && (
          <span className={view.stale ? styles.staleTag : styles.windowNote}>
            {view.stale ? "Last update " : ""}
            {soundStamp(new Date(view.asOfMs).toISOString(), new Date(nowMs))}
          </span>
        )}
      </div>

      {sailings.length === 0 ? (
        <p className={styles.absent}>
          No upcoming departures from {depName} are reporting space right now. Space is usually
          published a few hours ahead of each sailing.
        </p>
      ) : (
        <div className={styles.capacityList}>
          {sailings.map((sailing) => (
            <CapacityRow key={`${sailing.depart_ms}-${sailing.vessel}`} sailing={sailing} />
          ))}
        </div>
      )}

      {view.stale && sailings.length > 0 && (
        <p className={styles.foot}>
          This reading is more than a few minutes old - space may have changed since.
        </p>
      )}
      <p className={styles.foot}>
        Drive-up spaces left for vehicles without a reservation. Reserved spaces are a separate
        pool that WSF does not publish here.
      </p>
    </section>
  );
}

function CapacityRow({ sailing }: { sailing: CapacitySailing }) {
  const level = sailing.level;
  const levelClass = level ? LEVEL_CLASS[level] : styles.unknown;
  const max = sailing.max_space ?? 0;
  const left = sailing.drive_up ?? 0;
  // The meter shows how much room is LEFT, which is the thing being counted.
  const pct = max > 0 ? Math.max(2, Math.min(100, (left / max) * 100)) : 0;

  return (
    <div className={styles.capacityRow} data-testid="capacity-row" data-level={level ?? "unknown"}>
      <span className={styles.slotTime}>{soundTimeShort(sailing.depart_ms)}</span>
      {sailing.cancelled ? (
        <span className={styles.cancelledTag}>Cancelled</span>
      ) : (
        <span className={`${styles.capacityMeter} ${levelClass}`}>
          <span className={styles.capacityFill} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className={`${styles.spaces} ${levelClass}`}>
        {sailing.drive_up === null ? (
          <span className={styles.spacesLabel}>not published</span>
        ) : (
          <>
            {sailing.drive_up}
            <span className={styles.spacesLabel}>
              {" "}
              {sailing.drive_up === 1 ? "space" : "spaces"}
              {level && LEVEL_WORD[level] ? ` · ${LEVEL_WORD[level]}` : ""}
            </span>
          </>
        )}
      </span>
    </div>
  );
}
