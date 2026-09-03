"use client";

import { LoadingFerry } from "./LoadingFerry";
import styles from "./chrome.module.css";

/** The loading state draws the ferry (LoadingFerry; the voice line is its
 * accessible name). `failed` swaps in the honest failure state with a
 * retry - words, because a rider needs to act. */
export function LoadingVeil({
  gone,
  failed,
  onRetry,
}: {
  gone: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`${styles.veil} ${gone ? styles.veilGone : ""}`} aria-hidden={gone}>
      {failed ? (
        <div className={styles.veilInner}>
          <p>The Sound isn&apos;t answering right now.</p>
          <button className={styles.retry} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <LoadingFerry />
      )}
    </div>
  );
}
