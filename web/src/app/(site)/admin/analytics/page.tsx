import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

export default function AdminAnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsDashboard />
    </Suspense>
  );
}
