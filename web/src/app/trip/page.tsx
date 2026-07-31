import type { Metadata } from "next";
import Link from "next/link";
import { PairPicker } from "@/components/trip/PairPicker";
import styles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "Trips · Ferry Sound",
  description: "Next sailings, live make-it-or-miss-it status, and fares for every WSF crossing.",
};

export default function TripIndexPage() {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div className={styles.masthead}>
          <Link href="/" className={`display ${styles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
        </div>
        <h1 className={`display ${styles.pairTitle}`}>Where are you sailing?</h1>
        <PairPicker />
        <p className={styles.footNote}>
          Every published crossing on the Washington State Ferries system - live vessel status,
          the next two weeks of departures, and current fares. Planning further out? See the{" "}
          <Link href="/calendar">service calendar</Link> of scheduled cancellations, or set up{" "}
          <Link href="/alerts">email alerts</Link> for your run.
        </p>
      </div>
    </main>
  );
}
