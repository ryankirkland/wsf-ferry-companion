"use client";

import styles from "./chrome.module.css";

/** The loading voice: warm, brief, honest (direction.md). `failed` swaps in
 * the honest failure state with a retry. */
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
        <p className={styles.veilInner}>Talking to the Sound...</p>
      )}
    </div>
  );
}
