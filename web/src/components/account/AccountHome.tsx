"use client";

// /account's front door: signed-out visitors get the sign-in machine,
// signed-in ones get account management.

import { useAuth } from "@/hooks/use-auth";
import tripStyles from "@/components/trip/trip.module.css";
import { AccountView } from "./AccountView";
import { ManageAccount } from "./ManageAccount";

export function AccountHome() {
  const { state, signOut } = useAuth();
  if (state.status === "loading") {
    return <p className={tripStyles.rangeNote}>Checking session…</p>;
  }
  if (state.status === "in") {
    return <ManageAccount email={state.email} onSignOut={signOut} />;
  }
  return <AccountView />;
}
