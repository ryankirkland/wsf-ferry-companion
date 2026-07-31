"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getTerminalDims,
  getVesselDims,
  type TerminalDim,
  type VesselDim,
} from "@/lib/data/dims";
import { PAIRS } from "@/lib/trip/pairs";
import type { VesselFix } from "@/lib/data/types";
import { asOf, soundClock } from "@/lib/time/sound-time";
import styles from "./vessel-card.module.css";

function runLine(fix: VesselFix, terms: Map<number, TerminalDim> | null): string {
  const dep = terms?.get(fix.dep)?.name ?? `terminal ${fix.dep}`;
  if (fix.state === "yard") return `Resting at ${dep}`;
  if (fix.arr != null) {
    const arr = terms?.get(fix.arr)?.name ?? `terminal ${fix.arr}`;
    return `${dep} → ${arr}`;
  }
  return fix.state === "docked" ? `At dock in ${dep}` : dep;
}

function statusLine(fix: VesselFix): string {
  switch (fix.state) {
    case "underway":
      return `Underway · ${fix.speed.toFixed(1)} kn`;
    case "docked":
      return "At dock";
    case "yard":
      return "Out of service";
    case "stale":
      return `Position ${asOf(new Date(Date.now() - fix.age_s * 1000))}`;
  }
}

/** Honest delay line, or null - omission beats fake precision (direction.md). */
/** WSDOT's official drawing for this vessel's class.
 *
 * It is a CLASS drawing, not a portrait: all five Issaquah 130s share one,
 * so the caption says "class" rather than implying this is that hull. The
 * plate stays light in every mode because these are dark line drawings on
 * white - knock the background out and the hull outline disappears on a
 * night card. A drawing that fails to load (a class commissioned since the
 * last mirror run) removes itself rather than leaving a broken frame.
 */
function ClassDrawing({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className={styles.drawing} data-testid="class-drawing">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export,
          and the intrinsic size varies per class */}
      <img src={src} alt={`WSDOT profile drawing of a ${className}-class ferry`} onError={() => setFailed(true)} />
      <figcaption>WSDOT class drawing</figcaption>
    </figure>
  );
}

function delayLine(fix: VesselFix): { text: string; lateMin: number } | null {
  const sched = fix.sched ? Date.parse(fix.sched) : null;
  if (!sched) return null;
  const left = fix.left ? Date.parse(fix.left) : null;
  if (left) {
    const lateMin = Math.round((left - sched) / 60_000);
    // The delta only when it is plausible; the departure time is always factual.
    const delta = lateMin >= 1 && lateMin <= 120 ? ` (+${lateMin} min)` : "";
    return {
      text: `Left ${soundClock(new Date(left))} · scheduled ${soundClock(new Date(sched))}${delta}`,
      lateMin: Math.min(lateMin, 120),
    };
  }
  if (fix.state === "docked" && Date.now() > sched) {
    const lateMin = Math.round((Date.now() - sched) / 60_000);
    // Under 2 min isn't late; over 2 h the schedule data itself is clearly
    // not current - honest omission beats absurd precision either way.
    if (lateMin < 2 || lateMin > 120) return null;
    return { text: `Scheduled ${soundClock(new Date(sched))} · running ${lateMin} min behind`, lateMin };
  }
  return null;
}

export function VesselCard({ fix, onClose }: { fix: VesselFix; onClose: () => void }) {
  const [dim, setDim] = useState<VesselDim | null>(null);
  const [terms, setTerms] = useState<Map<number, TerminalDim> | null>(null);

  useEffect(() => {
    let alive = true;
    getVesselDims()
      .then((m) => alive && setDim(m.get(fix.id) ?? null))
      .catch(() => {});
    getTerminalDims()
      .then((m) => alive && setTerms(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fix.id]);

  const delay = delayLine(fix);
  const eta = fix.eta && fix.state === "underway" ? soundClock(new Date(fix.eta)) : null;

  return (
    <aside className={styles.card} data-testid="vessel-card">
      <button className={styles.close} onClick={onClose} aria-label="Close vessel details">
        ×
      </button>
      <h2 className={`display ${styles.name}`}>{fix.name}</h2>
      {dim && <p className={styles.klass}>{dim.class} class</p>}
      <p className={styles.run}>{runLine(fix, terms)}</p>
      <p className={styles.status}>
        {statusLine(fix)}
        {eta && ` · arrives about ${eta}`}
      </p>
      {delay && (
        <p className={`${styles.delay} ${delay.lateMin >= 5 ? styles.late : ""}`}>{delay.text}</p>
      )}
      {dim?.drawing && <ClassDrawing src={dim.drawing} className={dim.class} />}
      {dim && (
        <p className={styles.facts}>
          {dim.max_passengers.toLocaleString()} passengers · {dim.reg_deck_space} vehicles ·
          built {dim.year_built}
          {dim.year_rebuilt ? `, rebuilt ${dim.year_rebuilt}` : ""}
        </p>
      )}
      {(() => {
        // The card must never be a dead end: link to this run's schedule.
        const entry = Object.entries(PAIRS).find(
          ([, e]) => e.dep === fix.dep && e.arr === fix.arr,
        );
        return entry ? (
          <Link className={styles.tripLink} href={`/trip/${entry[0]}`}>
            Next sailings: {entry[1].depName} → {entry[1].arrName}
          </Link>
        ) : null;
      })()}
    </aside>
  );
}
