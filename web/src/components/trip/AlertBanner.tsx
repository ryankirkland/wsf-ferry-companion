import type { AlertItem } from "@/lib/trip/types";
import { alertDetails } from "@/lib/trip/alert-text";
import { soundStamp } from "@/lib/time/sound-time";
import styles from "./trip.module.css";

/** Route-matched WSF alerts - the same-day-truth surface. Cancellations
 * live in this free text until the today-refresh instrument proves the
 * schedule feed drops them (free-text sailing parsing is M3 scope).
 * Every alert carries its publish stamp: a delay notice from 9 AM means
 * something different at 5 PM. Text and body render only when they say
 * something the title did not (see alertDetails). */
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
        {alerts.map((a) => {
          const details = alertDetails(a);
          return (
            <div key={a.id} className={styles.alertItem}>
              <h4>
                {a.title}
                {a.published && (
                  <time dateTime={a.published} className={styles.alertStamp}>
                    {soundStamp(a.published)}
                  </time>
                )}
              </h4>
              {details.map((detail) => (
                <p key={detail}>{detail}</p>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}
