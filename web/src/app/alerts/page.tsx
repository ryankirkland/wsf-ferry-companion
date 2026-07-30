import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertsManager } from "@/components/account/AlertsManager";

export const metadata: Metadata = {
  title: "Email alerts · Ferry Sound",
  description:
    "One plain-language email when WSF cancels or delays sailings on your crossing, in your window.",
};

export default function AlertsPage() {
  return (
    <Suspense>
      <AlertsManager />
    </Suspense>
  );
}
