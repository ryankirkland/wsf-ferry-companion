"use client";

// Route filter control (owner's ask, 2026-08-20: checkboxes that hide
// routes, saved as a preference - "I care mostly about where Bremerton
// and Southworth routes are; the others become noise"). A pill under
// the mode switcher opens a checklist; unchecking a route hides its
// boats and exclusive terminals. Preference persists per device
// (localStorage); ambient applies it with no panel of its own.

import { useEffect, useRef, useState } from "react";
import { ROUTES, readHiddenRoutes, writeHiddenRoutes } from "@/lib/map/routes";
import styles from "./route-panel.module.css";

export function RoutePanel({
  onChange,
}: {
  onChange: (hidden: ReadonlySet<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Async read, same pattern as the notice cards: keeps the stored
    // preference out of the render-sync path.
    const t = window.setTimeout(() => setHidden(readHiddenRoutes()), 0);
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

  const filtering = hidden.size > 0;

  return (
    <div className={styles.root} ref={rootRef} data-testid="route-panel">
      <button
        type="button"
        className={filtering ? `${styles.pill} ${styles.pillActive}` : styles.pill}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Routes{filtering ? ` · ${ROUTES.length - hidden.size}` : ""}
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
          <button
            type="button"
            className={styles.all}
            disabled={!filtering}
            onClick={() => apply(new Set())}
          >
            Show all routes
          </button>
        </div>
      )}
    </div>
  );
}
