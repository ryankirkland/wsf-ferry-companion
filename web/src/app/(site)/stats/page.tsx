import type { Metadata } from "next";
import Link from "next/link";
import { StatsOverview } from "@/components/stats/StatsOverview";
import overview from "@/components/stats/overview.module.css";
import styles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "On-time record · Ferry Sound",
  description:
    "How often Washington State Ferries leave on time: 24 years of departures, by year, by month, by route and by boat.",
};

export default function StatsPage() {
  return (
    <main className={overview.page}>
      <div className={overview.column}>
        <div className={styles.masthead}>
          <Link href="/" className={styles.swap}>
            ← Back to map
          </Link>
          <Link href="/trip" className={styles.swap}>
            Plan a trip
          </Link>
        </div>

        <h1 className={`display ${overview.title}`}>The on-time record</h1>
        <p className={overview.subtitle}>
          Every departure Washington State Ferries has reported since 2002, and what it says about
          how often the boats leave when they say they will.
        </p>

        <StatsOverview />
      </div>
    </main>
  );
}
