"use client";

// The loading screen draws the boat (owner's call, 2026-09-01: "instead of
// 'Talking to the Sound' as the loading screen, a little SVG draw animation
// of a ferry"). The geometry IS the map's vessel sprite (lib/map/vessels/
// ferry-svg.ts) and the fills ride the same mode tokens - hull, cabin,
// windows, stack - so the boat being sketched is the boat that appears on
// the map a moment later; the DOM order matches the sprite too (stack first,
// so the cabin covers its base once filled), and the finished frame drops
// the sketch outlines for the sprite's own styling. Motion lives in
// LoadingFerry.module.css.
//
// The voice line survives as the loader's accessible name: this is an image
// named "Talking to the Sound...", not a live region. The page mounts the
// loader twice in quick succession (the dynamic-import placeholder, then
// MapView's own veil), and a live region inserted with content is announced
// unreliably - once, twice, or never, depending on the reader.
//
// That same double mount is why --ferry-phase exists: a fresh element would
// restart its CSS animation from the first stroke, visibly resetting the
// half-drawn boat the rider was watching. Both mounts instead derive their
// phase from performance.now(), so the second picks up where the first was.

import { useLayoutEffect, useRef } from "react";
import styles from "./LoadingFerry.module.css";

/** Must match the 3.4 s cycle in LoadingFerry.module.css. */
const CYCLE_MS = 3400;

/** A rounded rectangle as a path, so it can carry pathLength and a dash
 * like the hull does (rect's pathLength support is uneven across engines). */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

// Same numbers as FERRY_SVG, plus a wake line the map sprite leaves to its
// own wake layer.
const STACK = roundedRect(-4, -26, 8, 10, 2);
const HULL = "M-40 6 L-30 -12 L30 -12 L40 6 Q20 14 0 14 Q-20 14 -40 6 Z";
const CABIN = roundedRect(-24, -18, 48, 12, 4);
const WINDOWS = [-18, -8, 2, 12].map((x) => roundedRect(x, -15, 7, 5, 1.5));
const WINDOW_CLASSES = [styles.win1, styles.win2, styles.win3, styles.win4];
const WAKE = "M-46 19 Q-36 23 -26 19 T-6 19 T14 19 T34 19 T46 19";

export function LoadingFerry() {
  const ref = useRef<HTMLDivElement>(null);

  // Before first paint, so the resumed phase is what the rider sees.
  // Client-only by construction (an effect), so the static export's markup
  // and the hydrated markup agree.
  useLayoutEffect(() => {
    ref.current?.style.setProperty("--ferry-phase", `-${performance.now() % CYCLE_MS}ms`);
  }, []);

  return (
    <div
      ref={ref}
      className={styles.loader}
      role="img"
      aria-label="Talking to the Sound..."
      data-testid="loading-ferry"
    >
      <svg
        className={styles.ferry}
        viewBox="-48 -32 96 60"
        width="192"
        height="120"
        aria-hidden="true"
        focusable="false"
      >
        <path className={styles.stack} d={STACK} pathLength={1} />
        <path className={styles.hull} d={HULL} pathLength={1} />
        <path className={styles.cabin} d={CABIN} pathLength={1} />
        {WINDOWS.map((d, i) => (
          <path key={d} className={`${styles.win} ${WINDOW_CLASSES[i]}`} d={d} pathLength={1} />
        ))}
        <path className={styles.wake} d={WAKE} pathLength={1} />
      </svg>
    </div>
  );
}
