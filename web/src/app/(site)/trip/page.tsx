import type { Metadata } from "next";
import Link from "next/link";
import { PairPicker } from "@/components/trip/PairPicker";
import styles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "Sailing schedule · Ferry Sound",
  description: "Next sailings, live make-it-or-miss-it status, and fares for every WSF crossing.",
};

export default function TripIndexPage() {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div className={styles.masthead}>
          <Link href="/" className={styles.swap}>
            ← Back to map
          </Link>
        </div>
        <h1 className={`display ${styles.pairTitle}`}>Where are you sailing?</h1>
        <PairPicker />
        <p className={styles.footNote}>
          Every published crossing on the Washington State Ferries system - live vessel status,
          the next two weeks of departures, and current fares. Set up{" "}
          <Link href="/alerts">ferry alerts</Link> for your run to hear about cancellations the
          moment WSF publishes them.
        </p>
      </div>
    </main>
  );
}
