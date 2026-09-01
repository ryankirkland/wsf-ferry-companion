import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TripView } from "@/components/trip/TripView";
import { PAIRS } from "@/lib/trip/pairs";
import styles from "@/components/trip/trip.module.css";

// All 38 pairs pre-rendered at build; anything else is a real 404 via the
// static export's not-found page (dynamicParams=false).
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(PAIRS).map((pair) => ({ pair }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>;
}): Promise<Metadata> {
  const { pair } = await params;
  const entry = PAIRS[pair];
  if (!entry) return {};
  return {
    title: `${entry.depName} → ${entry.arrName} · Sound Ferries`,
    description: `Next ferry from ${entry.depName} to ${entry.arrName}: live departures, make-it-or-miss-it status, and fares.`,
  };
}

export default async function TripPairPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  const entry = PAIRS[pair];
  if (!entry) notFound();
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div className={styles.masthead}>
          <Link href="/" className={styles.swap}>
            ← Back to map
          </Link>
          <Link href="/trip" className={styles.swap}>
            Change route
          </Link>
        </div>

        {/* Each name carries an empty weather slot; TerminalWeather (inside
            TripView, which owns the viewed-sailing hour) portals a compact
            conditions chip into it once the forecast doc loads. Keeping the
            h1 server-rendered preserves the static export's real body. */}
        <h1 className={`display ${styles.pairTitle}`}>
          <span className={styles.pairEnd}>
            {entry.depName}
            <span id="wx-slot-dep" className={styles.wxSlot} />
          </span>{" "}
          <span className={styles.pairEnd}>
            {/* The arrow travels with the arrival name so a narrow wrap
                can never orphan it onto its own line. */}
            <span>→ {entry.arrName}</span>
            <span id="wx-slot-arr" className={styles.wxSlot} />
          </span>
        </h1>

        {/* TripView reads useSearchParams (?date=), which in a static export
            client-renders everything up to the nearest Suspense boundary. The
            boundary sits HERE - below the masthead and h1 - so every pair
            page ships a real document body instead of the empty <body> the
            whole-page boundary produced (use-search-params.md). */}
        <Suspense fallback={<p className={styles.rangeNote}>Loading sailings…</p>}>
          <TripView slug={pair} />
        </Suspense>
      </div>
    </main>
  );
}
