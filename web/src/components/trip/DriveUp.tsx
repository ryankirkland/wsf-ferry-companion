// F5 drive-up space, rendered ON the departure it describes.
//
// This used to be its own "Drive-up space" section below the schedule, which
// made the rider match clock times between two lists to answer one question:
// "will I get on THAT boat?" (owner's call, 2026-08-30). The reading now
// rides in the departure card and the section is gone.
//
// What did NOT move: the three absence states (docs/features/stats.md). A
// terminal that publishes nothing must say so in words, and the overnight
// feed-quiet case must not be reported as "this terminal does not report" -
// that false claim reached production once already. DriveUpNote carries them,
// plus the as-of stamp, the staleness label, and what the number means.
//
// The meter bar did not survive the move, deliberately: it drew
// drive_up / max_space, the ratio the contract refuses to publish because
// max_space includes reservable inventory we cannot see. The count and WSF's
// own colour say everything the bar did, without implying we know how full
// the boat is.

import { formatDriveUp, type CapacityView } from "@/lib/stats/reliability";
import type { CapacitySailing } from "@/lib/stats/types";
import { soundStamp } from "@/lib/time/sound-time";
import styles from "./trip.module.css";

const LEVEL_CLASS = {
  plenty: styles.driveUpPlenty,
  filling: styles.driveUpFilling,
  full: styles.driveUpFull,
} as const;

// Only the levels that change what a driver would do get a word; "plenty"
// needs no adjective, and adding one ("90 spaces, plenty") just pads it.
const LEVEL_WORD = { plenty: null, filling: "filling up", full: "nearly full" } as const;

/** The drive-up reading for one departure, or null when WSF has published
 * none for it - silence is better than "not published" on every card, and
 * the note under the list explains the absence once. */
export function DriveUpChip({ sailing }: { sailing: CapacitySailing }) {
  const levelClass = sailing.level ? LEVEL_CLASS[sailing.level] : styles.driveUpUnknown;

  if (sailing.cancelled) {
    return (
      <span className={`${styles.driveUp} ${styles.driveUpFull}`} data-testid="drive-up">
        Cancelled
      </span>
    );
  }

  if (sailing.drive_up === null) return null;

  const spaces = formatDriveUp(sailing.drive_up);
  const word = sailing.level ? LEVEL_WORD[sailing.level] : null;

  return (
    <span
      className={`${styles.driveUp} ${levelClass}`}
      data-testid="drive-up"
      data-level={sailing.level ?? "unknown"}
    >
      {spaces.full ? (
        "Drive-up full"
      ) : (
        <>
          <strong>{sailing.drive_up}</strong> drive-up{" "}
          {sailing.drive_up === 1 ? "space" : "spaces"}
          {word ? ` · ${word}` : ""}
        </>
      )}
    </span>
  );
}

/** What the numbers on the cards mean, when they were read, and - when
 * there are none - which of the three absences is the true one. */
export function DriveUpNote({
  view,
  depName,
  nowMs,
}: {
  view: CapacityView;
  depName: string;
  nowMs: number;
}) {
  // No document yet: say nothing rather than guess which absence applies.
  if (view.asOfMs === null && !view.reporting) return null;

  if (view.feedQuiet) {
    return (
      <p className={styles.driveUpAbsent} data-testid="capacity-quiet">
        WSF is not publishing drive-up space for any terminal right now. It usually returns during
        service hours.
      </p>
    );
  }

  if (!view.reporting) {
    return (
      <p className={styles.driveUpAbsent} data-testid="capacity-absent">
        {depName} does not report drive-up space to WSF, so the cards above show none. That is a gap
        in the published data, not a sign the lot is full.
      </p>
    );
  }

  if ((view.sailings ?? []).length === 0) {
    return (
      <p className={styles.driveUpAbsent} data-testid="capacity-empty">
        No upcoming departures from {depName} are reporting drive-up space right now. Space is
        usually published a few hours ahead of each sailing.
      </p>
    );
  }

  const stamp =
    view.asOfMs !== null ? soundStamp(new Date(view.asOfMs).toISOString(), new Date(nowMs)) : null;

  return (
    <p className={styles.driveUpNote} data-testid="capacity-note">
      {stamp && (
        <span className={view.stale ? styles.driveUpStale : undefined}>
          {view.stale ? `Drive-up space last updated ${stamp} - more than a few minutes old, so it may have changed. ` : `Drive-up space as of ${stamp}. `}
        </span>
      )}
      Spaces left for vehicles without a reservation. Reserved spaces are a separate pool that WSF
      does not publish here.
    </p>
  );
}
