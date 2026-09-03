// The loading screen draws the boat (owner's call, 2026-09-01: "instead of
// 'Talking to the Sound' as the loading screen, a little SVG draw animation
// of a ferry"). The geometry IS the map's vessel sprite (lib/map/vessels/
// ferry-svg.ts) so the boat being sketched is the boat that appears on the
// map a moment later, and the fills ride the same mode tokens - hull, cabin,
// windows, stack, wake - so the dusk lantern windows show up here too.
//
// Motion lives in chrome.module.css: hull, cabin, windows, stack and wake are
// stroked on in sequence, the fills fade in, the boat holds, fades, and the
// cycle repeats while the map chunk streams. `pathLength={1}` normalizes
// every dash to a unit length so the CSS never has to know a path's real
// length. prefers-reduced-motion gets the finished boat, still.
//
// The voice line survives as the accessible name: a screen reader hears
// "Talking to the Sound..." while a sighted rider watches it being drawn.

import styles from "./chrome.module.css";

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
const HULL = "M-40 6 L-30 -12 L30 -12 L40 6 Q20 14 0 14 Q-20 14 -40 6 Z";
const CABIN = roundedRect(-24, -18, 48, 12, 4);
const STACK = roundedRect(-4, -26, 8, 10, 2);
const WINDOWS = [-18, -8, 2, 12].map((x) => roundedRect(x, -15, 7, 5, 1.5));
const WAKE = "M-46 19 Q-36 23 -26 19 T-6 19 T14 19 T34 19 T46 19";

export function LoadingFerry() {
  return (
    <div className={styles.ferryLoader} role="status" data-testid="loading-ferry">
      <svg
        className={styles.ferry}
        viewBox="-48 -32 96 60"
        width="192"
        height="120"
        aria-hidden="true"
        focusable="false"
      >
        <path className={styles.ferryHull} d={HULL} pathLength={1} />
        <path className={styles.ferryCabin} d={CABIN} pathLength={1} />
        {WINDOWS.map((d, i) => (
          <path
            key={d}
            className={styles.ferryWin}
            d={d}
            pathLength={1}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
        <path className={styles.ferryStack} d={STACK} pathLength={1} />
        <path className={styles.ferryWake} d={WAKE} pathLength={1} />
      </svg>
      <span className={styles.srOnly}>Talking to the Sound...</span>
    </div>
  );
}
