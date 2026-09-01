import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountHome } from "@/components/account/AccountHome";
import tripStyles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "Account · Sound Ferries",
  description: "Manage your Sound Ferries account: email and password.",
};

// The shell is server-rendered so the static export carries a real body;
// AccountHome (auth state + useSearchParams in the sign-in machine) renders
// inside the boundary.
export default function AccountPage() {
  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={tripStyles.swap}>
            ← Back to map
          </Link>
        </div>

        <Suspense>
          <AccountHome />
        </Suspense>

        <p className={tripStyles.footNote}>
          Accounts exist for one thing: verified-email alert subscriptions - no newsletters. We do
          log anonymous page visits and clicks sitewide (never tied to your account, never for
          advertising) to catch bugs and understand traffic; you can opt out from the banner shown
          on your first visit.
        </p>
      </div>
    </main>
  );
}
