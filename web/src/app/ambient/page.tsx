import type { Metadata } from "next";
import { AmbientStage } from "@/components/ambient/AmbientStage";

// Server page so the route carries its own metadata (a "use client" page
// cannot): a wall display is not a search result, and it should not
// inherit the homepage's marketing description.
export const metadata: Metadata = {
  title: "Ambient · Ferry Sound",
  description: "The Sound on a wall: the live ferry map, framed, all day.",
  robots: { index: false },
};

export default function AmbientPage() {
  return <AmbientStage />;
}
