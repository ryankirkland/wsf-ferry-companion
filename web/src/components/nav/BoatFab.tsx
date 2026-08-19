"use client";

// The boat-button drawer: on the map it is the doorway to everything
// else; on every (site) page it is the narrow-screen navigation (wide
// screens get the SideNav rail). /ambient stays chromeless.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COGNITO_CLIENT_ID } from "@/config";
import { readStorage, YOUR_RUN_KEY } from "@/lib/storage";
import { PAIRS } from "@/lib/trip/pairs";
import styles from "./nav.module.css";

// Session presence WITHOUT the Cognito SDK: the SDK persists the signed-in
// username under this well-known key, and this drawer only needs to choose
// between "Account" and "Sign in" for a link label. Importing useAuth here
// dragged 109 KB of SRP crypto into the map landing page (audit finding:
// bundle-conditional); the pages behind the link do real auth.
const AUTH_USER_KEY = `CognitoIdentityServiceProvider.${COGNITO_CLIENT_ID}.LastAuthUser`;

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function readYourRun(): string | null {
  return readStorage(YOUR_RUN_KEY);
}

function readAuthUser(): string | null {
  return readStorage(AUTH_USER_KEY);
}

// Static SVG hoisted to module scope: BoatFab re-renders with every fleet
// poll, and this glyph never changes (rendering-hoist-jsx).
const boatGlyph = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none">
    <path d="M3.5 15.5h17l-1.6 3.2a2 2 0 0 1-1.8 1.1H6.9a2 2 0 0 1-1.8-1.1z" fill="currentColor" />
    <path d="M6.5 15V11a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 10V7.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V10" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export function BoatFab() {
  const [open, setOpen] = useState(false);
  const authUser = useSyncExternalStore(subscribeStorage, readAuthUser, () => null);
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
        {boatGlyph}
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
          <Link href="/" data-analytics-label="nav-map" onClick={() => setOpen(false)}>
            Live map
            <span>The Sound, right now</span>
          </Link>
          <Link href="/trip" data-analytics-label="nav-trip" onClick={() => setOpen(false)}>
            Trip planner
            <span>Next sailings, live status, fares</span>
          </Link>
          {yourRun && yourRunSlug && (
            <Link href={`/trip/${yourRunSlug}`} onClick={() => setOpen(false)}>
              Your run: {yourRun.depName} → {yourRun.arrName}
              <span>Straight to your crossing</span>
            </Link>
          )}
          <Link href="/stats" data-analytics-label="nav-stats" onClick={() => setOpen(false)}>
            On-time record
            <span>24 years of departures, by route and boat</span>
          </Link>
          <Link href="/alerts" data-analytics-label="nav-alerts" onClick={() => setOpen(false)}>
            Ferry Alerts
            <span>Your crossing, your window, one email</span>
          </Link>
          <Link href="/ambient" data-analytics-label="ambient-toggle" onClick={() => setOpen(false)}>
            Ambient mode
            <span>The Sound on a wall, all day</span>
          </Link>
          {authUser ? (
            <Link href="/account" data-analytics-label="nav-account" onClick={() => setOpen(false)}>
              Account
              <span>{authUser.includes("@") ? authUser : "Email and password"}</span>
            </Link>
          ) : (
            <Link
              href="/account?next=/alerts"
              data-analytics-label="nav-account"
              onClick={() => setOpen(false)}
            >
              Sign in
              <span>Create an account for ferry alerts</span>
            </Link>
          )}
        </nav>
      </aside>
    </>
  );
}
