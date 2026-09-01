import type { Metadata } from "next";
import { UnsubscribeView } from "@/components/account/UnsubscribeView";

export const metadata: Metadata = {
  title: "Unsubscribe · Sound Ferries",
  description: "Stop all Sound Ferries alert emails.",
};

export default function UnsubscribePage() {
  return <UnsubscribeView />;
}
