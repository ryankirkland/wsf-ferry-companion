"use client";

// From/To picker over the 38 published pairs. "To" is filtered to real
// mates of the chosen departure - impossible trips are unselectable, not
// an error state. Remembers your last-viewed run.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { PAIRS } from "@/lib/trip/pairs";
import styles from "./trip.module.css";

const YOUR_RUN_KEY = "fs.your-run";

// localStorage as an external store: hydration-safe (server snapshot is
// null, so the chip appears only after mount) and lint-clean.
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

export function PairPicker() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const yourRunSlug = useSyncExternalStore(subscribeStorage, readYourRun, () => null);
  const yourRun =
    yourRunSlug && PAIRS[yourRunSlug] ? { slug: yourRunSlug, entry: PAIRS[yourRunSlug] } : null;

  const departures = useMemo(() => {
    const names = new Map<number, string>();
    for (const entry of Object.values(PAIRS)) names.set(entry.dep, entry.depName);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, []);

  const arrivals = useMemo(() => {
    if (from === "") return [];
    const dep = Number(from);
    return Object.entries(PAIRS)
      .filter(([, e]) => e.dep === dep)
      .map(([slug, e]) => ({ slug, name: e.arrName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [from]);

  const go = () => {
    if (to !== "") router.push(`/trip/${to}`);
  };

  return (
    <div>
      <div className={styles.picker} data-testid="pair-picker">
        <label>
          From
          <select
            aria-label="From"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setTo("");
            }}
          >
            <option value="">Choose a terminal…</option>
            {departures.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            aria-label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={from === ""}
          >
            <option value="">{from === "" ? "Pick a departure first" : "Choose a destination…"}</option>
            {arrivals.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.go} onClick={go} disabled={to === ""}>
          Next sailings
        </button>
      </div>

      {yourRun && (
        <Link href={`/trip/${yourRun.slug}`} className={styles.yourRun}>
          Your run: {yourRun.entry.depName} → {yourRun.entry.arrName}
        </Link>
      )}
    </div>
  );
}
