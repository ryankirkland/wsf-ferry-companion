import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/CalendarView";

export const metadata: Metadata = {
  title: "Service calendar · Ferry Sound",
  description:
    "Scheduled WSF cancellations and added sailings for the months ahead - tidal cancellations, holiday extras, all of it.",
};

export default function CalendarPage() {
  return <CalendarView />;
}
