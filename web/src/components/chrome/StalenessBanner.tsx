"use client";

import type { FeedState } from "@/lib/data/types";
import { asOf } from "@/lib/time/sound-time";
import styles from "./chrome.module.css";

/** Whole-feed honesty: shown when the pipeline or the network is behind.
 * Clears itself on recovery. Per-vessel staleness is the markers' job. */
export function StalenessBanner({
  feedState,
  lastGoodAt,
}: {
  feedState: FeedState;
  lastGoodAt: number | null;
}) {
  if (feedState === "live") return null;
  const asOfText = lastGoodAt ? `Positions ${asOf(new Date(lastGoodAt))}` : "No positions yet";
  return (
    <p className={styles.staleBanner} role="status">
      {asOfText} - we&apos;re experiencing an outage.
    </p>
  );
}
