"use client";

// Route filter control (owner's ask, 2026-08-20: checkboxes that hide
// routes, saved as a preference - "I care mostly about where Bremerton
// and Southworth routes are; the others become noise"). A circle above
// the boat FAB (owner's placement call, 2026-08-21: the top-right pill
// sat on the clock) whose icon is two boats joined by a dotted S-curve;
// it opens a checklist card. Unchecking a route hides its boats and
// exclusive terminals. Preference persists per device (localStorage);
// ambient applies it with no panel of its own.

import { useEffect, useRef, useState } from "react";
import {
  ROUTES,
  readHiddenRoutes,
  readHideOutOfService,
  writeHiddenRoutes,
  writeHideOutOfService,
} from "@/lib/map/routes";
import styles from "./route-panel.module.css";

/** Two boats joined by a dotted S-curve - the route, as the map draws
 *  routes. Hulls match the FAB's silhouette language. */
function RouteGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M6.2 16.4 C 13.4 15.4, 10.2 9.6, 17.6 8.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeDasharray="0.1 3"
      />
      <g fill="currentColor">
        <rect x="3.4" y="17.1" width="3.6" height="1.6" rx="0.5" />
        <path d="M1.4 19.1h8.2l-1.4 2.3H2.8z" />
        <rect x="16.4" y="2.9" width="3.6" height="1.6" rx="0.5" />
        <path d="M14.4 4.9h8.2l-1.4 2.3h-5.4z" />
      </g>
    </svg>
  );
}

export function RoutePanel({
  onChange,
  onOosChange,
}: {
  onChange: (hidden: ReadonlySet<string>) => void;
  onOosChange: (hide: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hideOos, setHideOos] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Async read, same pattern as the notice cards: keeps the stored
    // preference out of the render-sync path.
    const t = window.setTimeout(() => {
      setHidden(readHiddenRoutes());
      setHideOos(readHideOutOfService());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const apply = (next: ReadonlySet<string>) => {
    setHidden(next);
    writeHiddenRoutes(next);
    onChange(next);
  };

  const toggle = (abbrev: string) => {
    const next = new Set(hidden);
    if (next.has(abbrev)) next.delete(abbrev);
    else next.add(abbrev);
    apply(next);
  };

  const toggleOos = () => {
    const next = !hideOos;
    setHideOos(next);
    writeHideOutOfService(next);
    onOosChange(next);
  };

  // The accent fill says "this map is filtered" - either way; the badge
  // counts routes only (an 8-route badge for a boats-only filter would
  // mislead).
  const filtering = hidden.size > 0 || hideOos;

  return (
    <div className={styles.root} ref={rootRef} data-testid="route-panel">
      <button
        type="button"
        className={filtering ? `${styles.circle} ${styles.circleActive}` : styles.circle}
        aria-label="Routes"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <RouteGlyph />
        {hidden.size > 0 && (
          <span className={styles.badge} data-testid="route-count" aria-hidden="true">
            {ROUTES.length - hidden.size}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.card} role="group" aria-label="Show routes">
          {ROUTES.map((r) => (
            <label key={r.abbrev} className={styles.row}>
              <input
                type="checkbox"
                checked={!hidden.has(r.abbrev)}
                onChange={() => toggle(r.abbrev)}
              />
              {r.label}
            </label>
          ))}
          <label className={`${styles.row} ${styles.oosRow}`}>
            <input type="checkbox" checked={!hideOos} onChange={toggleOos} />
            Out-of-service boats
          </label>
          <button
            type="button"
            className={styles.all}
            disabled={hidden.size === 0}
            onClick={() => apply(new Set())}
          >
            Show all routes
          </button>
        </div>
      )}
    </div>
  );
}
