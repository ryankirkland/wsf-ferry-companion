"use client";

// The signed-in /account view (owner's walk, 2026-08-19: "Account should
// just be where you manage your email and password" - the subscription
// manager is Ferry Alerts' job). Email display, password change, sign out.

import Link from "next/link";
import { useState } from "react";
import { changePassword } from "@/lib/auth/cognito";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./account.module.css";

export function ManageAccount({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await changePassword(currentPw, newPw);
      setNotice("Password changed.");
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setError((e as Error).message || "Could not change the password - try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className={`display ${tripStyles.pairTitle}`}>Your account</h1>

      <div className={styles.card} data-testid="manage-account">
        <div className={styles.signedInBar}>
          <span>{email}</span>
          <button onClick={onSignOut}>Sign out</button>
        </div>

        <p className={tripStyles.rangeNote} style={{ margin: 0 }}>
          Subscriptions live under <Link href="/alerts">Ferry Alerts</Link>.
        </p>
      </div>

      <form
        className={styles.card}
        data-testid="change-password"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className={styles.cardTitle}>Change password</h2>
        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <p className={styles.error}>{error}</p>}

        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <span className={styles.hint}>
            At least 12 characters with upper- and lowercase letters and a number.
          </span>
        </label>

        <button className={tripStyles.go} disabled={busy} type="submit">
          {busy ? "One moment…" : "Change password"}
        </button>
      </form>
    </>
  );
}
