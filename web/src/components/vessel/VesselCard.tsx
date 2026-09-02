"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  getTerminalDims,
  getVesselDims,
  type TerminalDim,
  type VesselDim,
} from "@/lib/data/dims";
import type { FleetUpdate } from "@/lib/data/fleet-poller";
import { PAIRS } from "@/lib/trip/pairs";
import type { VesselFix } from "@/lib/data/types";
import { asOf, soundClock } from "@/lib/time/sound-time";
import styles from "./vessel-card.module.css";

// The inline schedule pulls the sailing schedule's whole data + signal engine;
// loaded only when the disclosure opens, warmed on card mount so the tap
// feels instant (bundle-conditional).
const VesselSchedule = dynamic(
  () => import("./VesselSchedule").then((m) => m.VesselSchedule),
  { ssr: false },
);

function runLine(fix: VesselFix, terms: Map<number, TerminalDim> | null): string {
  const dep = terms?.get(fix.dep)?.name ?? `terminal ${fix.dep}`;
  if (fix.state === "yard") return `Resting at ${dep}`;
  if (fix.arr != null) {
    const arr = terms?.get(fix.arr)?.name ?? `terminal ${fix.arr}`;
    return `${dep} → ${arr}`;
  }
  return fix.state === "docked" ? `At dock in ${dep}` : dep;
}

function statusLine(fix: VesselFix): string | null {
  switch (fix.state) {
    case "underway":
      return null;
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

// Intrinsic sizes of the mirrored drawings (tools/vessel-drawings
// MANIFEST), keyed by asset slug. Without dimensions the browser reserved
// zero height and the facts line jumped down mid-read when the bitmap
// arrived. Ratios vary 65% across classes, so this is per-class, with the
// fleet-median ratio as the fallback for a class mirrored after this map
// was written.
const DRAWING_SIZES: Record<string, { w: number; h: number }> = {
  "evergreen-state": { w: 550, h: 131 },
  "issaquah-130": { w: 550, h: 120 },
  issaquah: { w: 550, h: 120 },
  "jumbo-mark-ii": { w: 550, h: 109 },
  jumbo: { w: 550, h: 94 },
  "kwa-di-tabil": { w: 549, h: 155 },
  olympic: { w: 550, h: 130 },
  super: { w: 550, h: 101 },
};
const DRAWING_FALLBACK = { w: 550, h: 120 };

function drawingSize(src: string): { w: number; h: number } {
  const slug = /\/([^/]+)\.png$/.exec(src)?.[1];
  return (slug && DRAWING_SIZES[slug]) || DRAWING_FALLBACK;
}

function ClassDrawing({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const { w, h } = drawingSize(src);
  return (
    <figure className={styles.drawing} data-testid="class-drawing">
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain img
          with explicit dimensions; next/image adds nothing under
          images.unoptimized and this card renders client-side only */}
      <img
        src={src}
        width={w}
        height={h}
        alt={`WSDOT profile drawing of a ${className}-class ferry`}
        onError={() => setFailed(true)}
      />
      <figcaption>WSDOT class drawing</figcaption>
    </figure>
  );
}

function departureLateMinutes(fix: VesselFix): number | null {
  if (!fix.left || !fix.sched) return null;
  const lateMs = Date.parse(fix.left) - Date.parse(fix.sched);
  // The card clocks omit seconds. Count only completed minutes so two
  // identical displayed times never claim the boat left one minute late.
  if (lateMs < 60_000 || lateMs > 120 * 60_000) return null;
  return Math.floor(lateMs / 60_000);
}


export function VesselCard({
  fix,
  fleet,
  onClose,
}: {
  fix: VesselFix;
  fleet: FleetUpdate;
  onClose: () => void;
}) {
  const [dim, setDim] = useState<VesselDim | null>(null);
  const [terms, setTerms] = useState<Map<number, TerminalDim> | null>(null);
  const [expanded, setExpanded] = useState(false);
  // A different boat means a different route (or none) - the schedule
  // always reopens on today for whichever boat is now selected, never the
  // day last browsed for the previous one. Adjusted during render (React's
  // "resetting state when a prop changes" pattern), not an effect, so it
  // never fires a redundant extra render.
  const [prevFixId, setPrevFixId] = useState(fix.id);
  if (fix.id !== prevFixId) {
    setPrevFixId(fix.id);
    setExpanded(false);
  }

  useEffect(() => {
    let alive = true;
    getVesselDims()
      .then((m) => alive && setDim(m.get(fix.id) ?? null))
      .catch(() => {});
    getTerminalDims()
      .then((m) => alive && setTerms(m))
      .catch(() => {});
    // Warm the schedule chunk: the disclosure tap must not wait on it.
    void import("./VesselSchedule");
    return () => {
      alive = false;
    };
  }, [fix.id]);

  const status = statusLine(fix);
  const leftAt = fix.left ? soundClock(new Date(fix.left)) : null;
  const departureLateMin = departureLateMinutes(fix);
  const eta = fix.eta && fix.state === "underway" ? soundClock(new Date(fix.eta)) : null;
  const depName = terms?.get(fix.dep)?.name ?? `terminal ${fix.dep}`;
  const arrName =
    fix.arr != null ? (terms?.get(fix.arr)?.name ?? `terminal ${fix.arr}`) : null;

  return (
    <aside className={styles.card} data-testid="vessel-card">
      <button className={styles.close} onClick={onClose} aria-label="Close vessel details">
        ×
      </button>
      <h2 className={`display ${styles.name}`}>{fix.name}</h2>
      {dim && <p className={styles.klass}>{dim.class} class</p>}
      {arrName ? (
        <div className={styles.route} data-testid="route-timing">
          <div className={styles.endpoint} data-testid="route-origin">
            <span className={styles.endpointTime} aria-hidden={!leftAt}>
              {leftAt ? `Left at ${leftAt}` : "\u00a0"}
              {departureLateMin !== null && (
                <span className={styles.endpointLate}> {departureLateMin} min late</span>
              )}
            </span>
            <span className={styles.terminal}>{depName}</span>
          </div>
          <span className={styles.arrow} aria-hidden>
            →
          </span>
          <div
            className={`${styles.endpoint} ${styles.destination}`}
            data-testid="route-destination"
          >
            <span className={styles.endpointTime} aria-hidden={!eta}>
              {eta ? `Est. arrival ${eta}` : "\u00a0"}
            </span>
            <span className={styles.terminal}>{arrName}</span>
          </div>
        </div>
      ) : (
        <p className={styles.run}>{runLine(fix, terms)}</p>
      )}
      {status && <p className={styles.status}>{status}</p>}
      {dim?.drawing && <ClassDrawing src={dim.drawing} className={dim.class} />}
      {dim && (
        <p className={styles.facts}>
          {dim.max_passengers.toLocaleString()} passengers · {dim.reg_deck_space} vehicles ·
          built {dim.year_built}
          {dim.year_rebuilt ? `, rebuilt ${dim.year_rebuilt}` : ""}
        </p>
      )}
      {(() => {
        // The card must never be a dead end: an inline look at this run's
        // schedule, expanded in place rather than navigating away.
        const entry = Object.entries(PAIRS).find(
          ([, e]) => e.dep === fix.dep && e.arr === fix.arr,
        );
        if (!entry) return null;
        const [, pair] = entry;
        return (
          <div className={styles.scheduleWrap} data-expanded={expanded} data-testid="schedule-wrap">
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
            {expanded && <VesselSchedule entry={pair} fleet={fleet} />}
          </div>
        );
      })()}
    </aside>
  );
}
