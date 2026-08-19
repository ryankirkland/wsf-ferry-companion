"use client";

// Ferry Alerts wears two hats: YOUR subscriptions (email when your
// crossing is disrupted) and the whole system's active bulletins. The
// tabs keep the personal surface primary while giving the "what's
// happening out there" question a home that needs no account.

import { useState } from "react";
import { AlertsManager } from "./AlertsManager";
import { AllActiveAlerts } from "./AllActiveAlerts";
import styles from "./account.module.css";

export function AlertsTabs() {
  const [tab, setTab] = useState<"mine" | "all">("mine");
  return (
    <>
      <div className={styles.windowChips} role="tablist" aria-label="Alert views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          className={tab === "mine" ? styles.chipActive : ""}
          onClick={() => setTab("mine")}
        >
          Your alerts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          className={tab === "all" ? styles.chipActive : ""}
          onClick={() => setTab("all")}
          data-testid="tab-all-alerts"
        >
          All active alerts
        </button>
      </div>
      {tab === "mine" ? <AlertsManager /> : <AllActiveAlerts />}
    </>
  );
}
