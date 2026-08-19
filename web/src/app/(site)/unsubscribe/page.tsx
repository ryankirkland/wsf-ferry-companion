import type { Metadata } from "next";
import { UnsubscribeView } from "@/components/account/UnsubscribeView";

export const metadata: Metadata = {
  title: "Unsubscribe · Ferry Sound",
  description: "Stop all Ferry Sound alert emails.",
};

export default function UnsubscribePage() {
  return <UnsubscribeView />;
}
