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
    title: `${entry.depName} → ${entry.arrName} · Ferry Sound`,
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
          <Link href="/" className={`display ${styles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
          <Link href="/trip" className={styles.swap}>
            Change route
          </Link>
        </div>

        <h1 className={`display ${styles.pairTitle}`}>
          {entry.depName} → {entry.arrName}
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
