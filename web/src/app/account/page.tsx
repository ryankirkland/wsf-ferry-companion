import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountView } from "@/components/account/AccountView";
import tripStyles from "@/components/trip/trip.module.css";

export const metadata: Metadata = {
  title: "Account · Ferry Sound",
  description: "Sign in to manage your ferry alert subscriptions.",
};

// The shell is server-rendered so the static export carries a real body;
// AccountView (useSearchParams + the sign-in state machine, including the
// mode-dependent h1) renders inside the boundary.
export default function AccountPage() {
  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
        </div>

        <Suspense>
          <AccountView />
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
