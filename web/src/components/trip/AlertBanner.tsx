import type { AlertItem } from "@/lib/trip/types";
import { soundStamp } from "@/lib/time/sound-time";
import styles from "./trip.module.css";

/** Route-matched WSF alerts - the same-day-truth surface. Cancellations
 * live in this free text until the today-refresh instrument proves the
 * schedule feed drops them (free-text sailing parsing is M3 scope).
 * Every alert carries its publish stamp: a delay notice from 9 AM means
 * something different at 5 PM. */
export function AlertBanner({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null;
  const [first] = alerts;
  return (
    <details className={styles.alertBanner} data-testid="alert-banner">
      <summary className={styles.alertSummary}>
        <span>{first!.title}</span>
        <span className={styles.alertCount}>
          {first!.published && <time dateTime={first!.published}>{soundStamp(first!.published)}</time>}
          {alerts.length > 1 && ` · +${alerts.length - 1} more`}
        </span>
      </summary>
      <div className={styles.alertBody}>
        {alerts.map((a) => (
          <div key={a.id} className={styles.alertItem}>
            <h4>
              {a.title}
              {a.published && (
                <time dateTime={a.published} className={styles.alertStamp}>
                  {soundStamp(a.published)}
                </time>
              )}
            </h4>
            {a.text && <p>{a.text}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
