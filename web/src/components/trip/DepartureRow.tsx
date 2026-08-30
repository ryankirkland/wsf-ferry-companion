import Link from "next/link";
import type { ReactNode } from "react";
import type { CapacitySailing } from "@/lib/stats/types";
import type { Signal } from "@/lib/trip/signal";
import type { Sailing } from "@/lib/trip/types";
import { soundTimeShort } from "@/lib/time/sound-time";
import { DriveUpChip } from "./DriveUp";
import { SignalPill } from "./SignalPill";
import styles from "./trip.module.css";

const MIN = 60_000;

export interface DepartureRowProps {
  sailing: Sailing;
  signal: Signal;
  cancelledReason: string | null;
  crossingMin: number | null;
  /** WSF's live drive-up reading for THIS departure, joined on depart_ms;
   *  null whenever the terminal, the sailing, or the hour has none. */
  capacity?: CapacitySailing | null;
}

export function DepartureRow({
  sailing,
  signal,
  cancelledReason,
  crossingMin,
  capacity = null,
}: DepartureRowProps) {
  const cancelled = cancelledReason !== null;
  const past = signal.state === "departed" || signal.state === "gone";
  const arriveMs = crossingMin !== null ? sailing.depart_ms + crossingMin * MIN : null;

  const meta: ReactNode[] = [];
  if (cancelled) {
    meta.push(
      <span key="reason" className={styles.reason}>
        {cancelledReason}
      </span>,
    );
  } else {
    // The clock-form headline ("Leaves at 7:30 PM") just repeats the row's
    // own time cell, and gone rows already say it all by fading - show
    // only what adds information.
    const clockForm = signal.headline === `Leaves at ${soundTimeShort(sailing.depart_ms)}`;
    const status =
      signal.state === "gone"
        ? null
        : clockForm
          ? signal.detail
          : `${signal.headline}${signal.detail ? ` · ${signal.detail}` : ""}`;
    if (status) meta.push(<span key="status">{status}</span>);
    if (arriveMs !== null && !past) {
      meta.push(<span key="arr">~ arrives {soundTimeShort(arriveMs)}</span>);
    }
  }
  // Drive-up space rides with the sailing it describes. A row already
  // struck as cancelled says that once, in the pill.
  if (capacity && !cancelled) {
    meta.push(<DriveUpChip key="driveup" sailing={capacity} />);
  }
  if (sailing.added) meta.push(<span key="added">Added sailing</span>);
  if (sailing.after_midnight) meta.push(<span key="am">Late night</span>);
  for (const [i, note] of sailing.notes.entries()) meta.push(<span key={`n${i}`}>{note}</span>);

  const rowClass = [
    styles.row,
    past ? styles.rowPast : "",
    cancelled ? styles.rowCancelled : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClass} data-state={cancelled ? "cancelled" : signal.state}>
      <span className={styles.time}>{soundTimeShort(sailing.depart_ms)}</span>
      <span className={styles.vesselCell}>
        <Link className={styles.vessel} href={`/?vessel=${sailing.vessel_id}`}>
          {signal.live && <span className={styles.liveDot} aria-hidden />}
          {sailing.vessel}
        </Link>
      </span>
      {cancelled ? (
        <span className={`${styles.pill} ${styles.pillMuted}`}>Cancelled</span>
      ) : (
        <SignalPill signal={signal} />
      )}
      {meta.length > 0 && <span className={styles.rowMeta}>{meta}</span>}
    </li>
  );
}
