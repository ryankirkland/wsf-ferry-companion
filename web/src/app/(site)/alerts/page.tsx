import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertsTabs } from "@/components/account/AlertsTabs";
import tripStyles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "Ferry Alerts · Ferry Sound",
  description:
    "One plain-language email when WSF cancels or delays sailings on your crossing, in your window.",
};

// The shell is server-rendered so the static export carries a real body;
// AlertsTabs (subscriptions + all-active bulletins) renders inside the boundary.
export default function AlertsPage() {
  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={tripStyles.swap}>
            ← Back to map
          </Link>
          <Link href="/trip" className={tripStyles.swap}>
            Sailing schedule
          </Link>
        </div>
        <h1 className={`display ${tripStyles.pairTitle}`}>Ferry Alerts</h1>

        <Suspense fallback={<p className={tripStyles.rangeNote}>Checking session…</p>}>
          <AlertsTabs />
        </Suspense>

        <p className={tripStyles.footNote}>
          Alerts come from WSF&apos;s official bulletin feed. When WSF names specific sailings we
          match them to your window precisely; when it doesn&apos;t, we tell you honestly that we
          couldn&apos;t narrow it down.
        </p>
      </div>
    </main>
  );
}
