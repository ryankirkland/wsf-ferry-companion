"use client";

// The map's doorway to everything that isn't the map: a small boat-button
// bottom-left opening a Paper Sound drawer (trip planner, your run, the
// service calendar, ambient mode). The map stays chrome-light; /ambient
// stays chromeless and never renders this.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PAIRS } from "@/lib/trip/pairs";
import styles from "./nav.module.css";

const YOUR_RUN_KEY = "fs.your-run";

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function readYourRun(): string | null {
  try {
    return window.localStorage.getItem(YOUR_RUN_KEY);
  } catch {
    return null;
  }
}

function BoatGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none">
      <path d="M3.5 15.5h17l-1.6 3.2a2 2 0 0 1-1.8 1.1H6.9a2 2 0 0 1-1.8-1.1z" fill="currentColor" />
      <path d="M6.5 15V11a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 10V7.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V10" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function BoatFab() {
  const [open, setOpen] = useState(false);
  const { state: auth } = useAuth();
  const yourRunSlug = useSyncExternalStore(subscribeStorage, readYourRun, () => null);
  const yourRun = yourRunSlug && PAIRS[yourRunSlug] ? PAIRS[yourRunSlug] : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        className={styles.fab}
        aria-label="Trips and more"
        aria-expanded={open}
        data-testid="boat-fab"
        onClick={() => setOpen(true)}
      >
        <BoatGlyph />
      </button>

      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}

      <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`} aria-hidden={!open} data-testid="nav-drawer">
        <div className={styles.drawerHead}>
          <span className={`display ${styles.drawerTitle}`}>
            Ferry <span>Sound</span>
          </span>
          <button className={styles.close} aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <nav className={styles.links}>
          <Link href="/trip" onClick={() => setOpen(false)}>
            Trip planner
            <span>Next sailings, live status, fares</span>
          </Link>
          {yourRun && yourRunSlug && (
            <Link href={`/trip/${yourRunSlug}`} onClick={() => setOpen(false)}>
              Your run: {yourRun.depName} → {yourRun.arrName}
              <span>Straight to your crossing</span>
            </Link>
          )}
          <Link href="/calendar" onClick={() => setOpen(false)}>
            Service calendar
            <span>Scheduled cancellations, months ahead</span>
          </Link>
          <Link href="/stats" onClick={() => setOpen(false)}>
            On-time record
            <span>24 years of departures, by route and boat</span>
          </Link>
          <Link href="/alerts" onClick={() => setOpen(false)}>
            Email alerts
            <span>Your crossing, your window, one email</span>
          </Link>
          <Link href="/ambient" onClick={() => setOpen(false)}>
            Ambient mode
            <span>The Sound on a wall, all day</span>
          </Link>
          {auth.status === "in" ? (
            <Link href="/alerts" onClick={() => setOpen(false)}>
              Account
              <span>{auth.email}</span>
            </Link>
          ) : (
            <Link href="/account?next=/alerts" onClick={() => setOpen(false)}>
              Sign in
              <span>Create an account for email alerts</span>
            </Link>
          )}
        </nav>
      </aside>
    </>
  );
}
