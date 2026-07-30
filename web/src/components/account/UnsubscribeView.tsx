"use client";

// The unsubscribe button page. Email links land here with the token in
// the URL FRAGMENT (never sent to servers, never logged); nothing happens
// until the human presses the button - mail scanners GET links, and a GET
// must never unsubscribe anyone. Mail-client one-click POSTs skip this
// page entirely (RFC 8058 goes straight to the API).

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { unsubscribeAll } from "@/lib/data/alerts-api";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./account.module.css";

type State = { step: "confirm" } | { step: "done"; removed: number } | { step: "error"; message: string };

// The URL fragment as an external store: hydration-safe (server snapshot
// empty) and it tracks hash edits without effect-driven setState.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function UnsubscribeView() {
  const token = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.replace(/^#/, ""),
    () => "",
  );
  const [state, setState] = useState<State>({ step: "confirm" });
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const removed = await unsubscribeAll(token);
      setState({ step: "done", removed });
    } catch {
      setState({ step: "error", message: "This link is invalid or was already used." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
        </div>
        <h1 className={`display ${tripStyles.pairTitle}`}>Unsubscribe</h1>

        <div className={styles.card} data-testid="unsubscribe-card">
          {state.step === "confirm" && (
            <>
              <p style={{ margin: 0 }}>
                This stops <strong>all</strong> Ferry Sound alert emails to your address. To trim
                individual crossings instead, use{" "}
                <Link href="/alerts">manage subscriptions</Link>.
              </p>
              <button className={tripStyles.go} onClick={() => void go()} disabled={busy || !token}>
                {busy ? "One moment…" : "Unsubscribe from everything"}
              </button>
              {!token && (
                <span className={styles.hint}>
                  This page needs the link from one of our emails.
                </span>
              )}
            </>
          )}
          {state.step === "done" && (
            <p style={{ margin: 0 }} data-testid="unsubscribed">
              Done - {state.removed} subscription{state.removed === 1 ? "" : "s"} removed. No more
              emails. If you change your mind, <Link href="/alerts">resubscribe any time</Link>.
            </p>
          )}
          {state.step === "error" && <p className={styles.error}>{state.message}</p>}
        </div>
      </div>
    </main>
  );
}
