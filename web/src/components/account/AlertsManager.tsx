"use client";

// The subscription manager: your crossings, your windows. Signed-out
// visitors get the pitch and a door; signed-in riders manage
// subscriptions against the JWT API. ?dep=&arr= prefills the picker
// (pair pages link here with their own crossing).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  ApiError,
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  type Subscription,
} from "@/lib/data/alerts-api";
import { PAIRS } from "@/lib/trip/pairs";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./account.module.css";

const PRESETS: [string, string, string][] = [
  ["Morning", "05:00", "09:00"],
  ["Midday", "09:00", "15:00"],
  ["Evening", "15:00", "19:00"],
  ["Late", "19:00", "23:30"],
];

export function AlertsManager() {
  const { state, signOut } = useAuth();
  const params = useSearchParams();
  const pathname = usePathname();
  // Send sign-in back to EXACTLY here - a "Get alerts for this run" deep
  // link must keep its ?dep&arr through the account flow.
  const nextHere = encodeURIComponent(
    `${pathname}${params.size ? `?${params.toString()}` : ""}`,
  );

  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
          <Link href="/trip" className={tripStyles.swap}>
            Trip planner
          </Link>
        </div>
        <h1 className={`display ${tripStyles.pairTitle}`}>Email alerts</h1>

        {state.status === "loading" && <p className={tripStyles.rangeNote}>Checking session…</p>}

        {state.status === "out" && (
          <div className={styles.card} data-testid="signed-out">
            <p style={{ margin: 0 }}>
              Pick a crossing and a time window; when WSF cancels or delays sailings that touch
              it, you get one plain-language email - usually within two minutes of WSF publishing.
              No spam: capped, deduplicated, one-click unsubscribe.
            </p>
            <Link className={tripStyles.go} style={{ textAlign: "center", textDecoration: "none" }} href={`/account?next=${nextHere}`}>
              Sign in or create an account
            </Link>
          </div>
        )}

        {state.status === "in" && (
          <Manager
            idToken={state.idToken}
            email={state.email}
            onSignOut={signOut}
            prefill={{ dep: params.get("dep"), arr: params.get("arr") }}
          />
        )}

        <p className={tripStyles.footNote}>
          Alerts come from WSF&apos;s official bulletin feed. When WSF names specific sailings we
          match them to your window precisely; when it doesn&apos;t, we tell you honestly that we
          couldn&apos;t narrow it down.
        </p>
      </div>
    </main>
  );
}

function Manager({
  idToken,
  email,
  onSignOut,
  prefill,
}: {
  idToken: string;
  email: string;
  onSignOut: () => void;
  prefill: { dep: string | null; arr: string | null };
}) {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prefillSlug = useMemo(() => {
    if (!prefill.dep || !prefill.arr) return "";
    return (
      Object.entries(PAIRS).find(
        ([, e]) => e.dep === Number(prefill.dep) && e.arr === Number(prefill.arr),
      )?.[0] ?? ""
    );
  }, [prefill.dep, prefill.arr]);
  const [slug, setSlug] = useState(prefillSlug);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("19:00");

  const load = useCallback(() => {
    listSubscriptions(idToken)
      .then(setSubs)
      .catch((e: unknown) => setError((e as Error).message));
  }, [idToken]);

  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const add = async () => {
    const entry = PAIRS[slug];
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      await createSubscription(idToken, {
        dep: entry.dep,
        arr: entry.arr,
        window_start: start,
        window_end: end,
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save - try again");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteSubscription(idToken, id);
      load();
    } finally {
      setBusy(false);
    }
  };

  const crossings = useMemo(
    () =>
      Object.entries(PAIRS)
        .map(([s, e]) => ({ slug: s, label: `${e.depName} → ${e.arrName}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  return (
    <>
      <div className={styles.signedInBar}>
        <span>{email}</span>
        <button onClick={onSignOut}>Sign out</button>
      </div>

      {subs === null && !error && <p className={tripStyles.rangeNote}>Loading subscriptions…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {subs !== null && subs.length > 0 && (
        <ul className={styles.list} data-testid="sub-list">
          {subs.map((s) => (
            <li key={s.id} className={styles.subRow}>
              <span>
                <span className={styles.subRoute}>
                  {s.dep_name} → {s.arr_name}
                </span>{" "}
                <span className={styles.subWindow}>
                  {s.window_start}-{s.window_end}
                </span>
              </span>
              <button onClick={() => void remove(s.id)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {subs !== null && subs.length === 0 && (
        <p className={tripStyles.rangeNote}>No subscriptions yet - add your run below.</p>
      )}

      <div className={styles.card} data-testid="add-subscription">
        <label>
          Crossing
          <select aria-label="Crossing" value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">Choose a crossing…</option>
            {crossings.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.windowChips} role="group" aria-label="Time window">
          {PRESETS.map(([label, s, e]) => (
            <button
              key={label}
              type="button"
              className={start === s && end === e ? styles.chipActive : ""}
              onClick={() => {
                setStart(s);
                setEnd(e);
              }}
            >
              {label} {s}-{e}
            </button>
          ))}
        </div>

        <div className={styles.timeRow}>
          <label>
            From
            <input type="time" aria-label="Window start" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="time" aria-label="Window end" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <button className={tripStyles.go} onClick={() => void add()} disabled={busy || !slug || start >= end}>
          {busy ? "Saving…" : "Subscribe"}
        </button>
        {start >= end && <span className={styles.hint}>The window must start before it ends.</span>}
      </div>
    </>
  );
}
