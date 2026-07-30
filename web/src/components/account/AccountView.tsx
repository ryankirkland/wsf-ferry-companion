"use client";

// Sign up / confirm / sign in / reset - one small state machine, Paper
// Sound styling, SRP under the hood. On success: back to ?next= (the
// alerts manager is the only caller today).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  resendCode,
  signIn,
  signUp,
} from "@/lib/auth/cognito";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./account.module.css";

type Mode = "signin" | "signup" | "confirm" | "forgot" | "reset";

const TITLES: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create your account",
  confirm: "Check your email",
  forgot: "Reset your password",
  reset: "Choose a new password",
};

export function AccountView() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/alerts";
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        await signIn(email, password);
        router.push(next);
      } else if (mode === "signup") {
        await signUp(email, password);
        setNotice(`We emailed a confirmation code to ${email.trim().toLowerCase()}.`);
        setMode("confirm");
      } else if (mode === "confirm") {
        await confirmSignUp(email, code);
        await signIn(email, password);
        router.push(next);
      } else if (mode === "forgot") {
        await forgotPassword(email);
        setNotice("If that address has an account, a reset code is on its way.");
        setMode("reset");
      } else {
        await confirmForgotPassword(email, code, password);
        await signIn(email, password);
        router.push(next);
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "UserNotConfirmedException") {
        setNotice("This account still needs its email confirmed - code re-sent.");
        void resendCode(email).catch(() => undefined);
        setMode("confirm");
      } else {
        setError(err.message || "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  };

  const needsEmail = true;
  const needsPassword = mode === "signin" || mode === "signup" || mode === "reset";
  const needsCode = mode === "confirm" || mode === "reset";

  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
        </div>
        <h1 className={`display ${tripStyles.pairTitle}`}>{TITLES[mode]}</h1>

        <form
          className={styles.card}
          data-testid="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {notice && <p className={styles.notice}>{notice}</p>}
          {error && <p className={styles.error}>{error}</p>}

          {needsEmail && (
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={mode === "confirm" || mode === "reset"}
              />
            </label>
          )}
          {needsCode && (
            <label>
              Confirmation code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          {needsPassword && (
            <label>
              {mode === "reset" ? "New password" : "Password"}
              <input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== "signin" && (
                <span className={styles.hint}>
                  At least 12 characters with upper- and lowercase letters and a number.
                </span>
              )}
            </label>
          )}

          <button className={tripStyles.go} disabled={busy} type="submit">
            {busy ? "One moment…" : TITLES[mode]}
          </button>

          <div className={styles.links}>
            {mode === "signin" && (
              <>
                <button type="button" onClick={() => setMode("signup")}>
                  New here? Create an account
                </button>
                <button type="button" onClick={() => setMode("forgot")}>
                  Forgot password
                </button>
              </>
            )}
            {mode !== "signin" && (
              <button type="button" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            )}
            {mode === "confirm" && (
              <button type="button" onClick={() => void resendCode(email)}>
                Re-send the code
              </button>
            )}
          </div>
        </form>

        <p className={tripStyles.footNote}>
          Accounts exist for one thing: verified-email alert subscriptions. No tracking, no
          newsletters - just your boats.
        </p>
      </div>
    </main>
  );
}
