import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountView } from "@/components/account/AccountView";

export const metadata: Metadata = {
  title: "Account · Ferry Sound",
  description: "Sign in to manage your ferry alert subscriptions.",
};

export default function AccountPage() {
  return (
    <Suspense>
      <AccountView />
    </Suspense>
  );
}
