"use client";

import { useState } from "react";
import type { PairFares } from "@/lib/trip/types";
import styles from "./trip.module.css";

/** Fares with the honesty rules baked in: resolved via LineItemLookup
 * upstream (never positional, never doubled one-way), Decimal-as-string
 * amounts rendered verbatim, and an effective label synthesized from
 * retrieval time because the API exposes no effective-date field. */
export function FaresPanel({ fares, viewDate }: { fares: PairFares; viewDate: string }) {
  const [direction, setDirection] = useState<"one_way" | "round_trip">("one_way");
  const [showAll, setShowAll] = useState(false);

  const items = fares[direction];
  const shown = showAll ? items : items.filter((f) => f.basic);
  const hiddenCount = items.length - shown.length;
  const adult = fares.one_way.find((f) => f.basic && f.category === "Passenger");
  const retrieved = fares.retrieved_at.slice(0, 10);
  const futureView = viewDate > fares.trip_date;

  return (
    <details className={styles.fares} data-testid="fares-panel">
      <summary className={styles.faresSummary}>
        <span>Fares</span>
        {adult && <span className={styles.faresHint}>adult ${adult.amount} one-way</span>}
      </summary>

      <div className={styles.faresToggle} role="tablist" aria-label="Fare direction">
        {(
          [
            ["one_way", "One-way"],
            ["round_trip", "Round trip"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={direction === key}
            className={direction === key ? styles.toggleActive : ""}
            onClick={() => setDirection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className={styles.faresFooter}>No {direction === "round_trip" ? "round-trip" : "one-way"} fares are published for this crossing.</p>
      ) : (
        <table className={styles.fareTable}>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id}>
                <td>
                  {f.label}
                  <span className={styles.fareCategory}>{f.category}</span>
                </td>
                <td>${f.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hiddenCount > 0 && (
        <button className={styles.allFares} onClick={() => setShowAll(true)}>
          All fares ({items.length})
        </button>
      )}
      {showAll && hiddenCount === 0 && items.length > 0 && (
        <button className={styles.allFares} onClick={() => setShowAll(false)}>
          Fewer fares
        </button>
      )}

      <p className={styles.faresFooter}>
        {fares.collection && <>{fares.collection} </>}
        Fares for travel {fares.trip_date}, retrieved {retrieved}.
        {futureView && " You're browsing a future date - today's fare tables are shown; WSF applies any seasonal change on the travel date."}
      </p>
    </details>
  );
}
