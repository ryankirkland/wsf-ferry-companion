import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TripView } from "@/components/trip/TripView";
import { PAIRS } from "@/lib/trip/pairs";

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
  if (!PAIRS[pair]) notFound();
  return (
    // Suspense: useSearchParams (the ?date= picker) requires a boundary in
    // static export; the fallback is the page shell rendered by TripView.
    <Suspense>
      <TripView slug={pair} />
    </Suspense>
  );
}
