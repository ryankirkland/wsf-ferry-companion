import type { GhostCancel } from "@/lib/trip/day";
import type { AlertItem } from "@/lib/trip/types";
import { soundTimeShort } from "@/lib/time/sound-time";
import { ALERT_ITEM_ID, ROUTE_ALERTS_ID } from "./AlertBanner";
import styles from "./trip.module.css";

/** A cancelled slot with no sailing left to strike (see GhostCancel): the
 * row sits where the boat would have been, in the struck voice of a
 * cancelled sailing, with no vessel because WSF removed the sailing from
 * its published times. Links to the bulletin that explains it when one
 * does; the link opens the route-alerts disclosure before the browser
 * jumps to the item, since a closed <details> hides its anchor. */
export function CancelledSlotRow({
  ghost,
  alert,
  past,
}: {
  ghost: GhostCancel;
  alert: AlertItem | null;
  /** Slot already behind the clock - fades like a departed row. */
  past: boolean;
}) {
  const openAlerts = () => {
    const details = document.getElementById(ROUTE_ALERTS_ID);
    if (details instanceof HTMLDetailsElement) details.open = true;
  };
  return (
    <li
      className={[styles.row, styles.rowCancelled, styles.rowGhost, past ? styles.rowPast : ""]
        .filter(Boolean)
        .join(" ")}
      data-state="removed"
      data-testid="cancelled-slot"
    >
      <span className={styles.time}>{soundTimeShort(ghost.depart_ms)}</span>
      <span className={styles.vesselCell}>
        <span className={styles.ghostVessel}>
          {ghost.certain ? "Sailing removed by WSF" : "A sailing from this terminal"}
        </span>
      </span>
      <span className={`${styles.pill} ${styles.pillMuted}`}>Cancelled</span>
      <span className={styles.rowMeta}>
        <span className={styles.reason}>{ghost.reason}</span>
        {/* Multi-terminal route: timeadj names the departure terminal only,
            so the boat may have been bound for another destination. */}
        {!ghost.certain && <span>may have been bound elsewhere on this route</span>}
        {alert && (
          <a className={styles.slotAlertLink} href={`#${ALERT_ITEM_ID(alert.id)}`} onClick={openAlerts}>
            See WSF alert
          </a>
        )}
      </span>
    </li>
  );
}
