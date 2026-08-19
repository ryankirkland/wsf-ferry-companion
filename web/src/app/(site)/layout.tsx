import { BoatFab } from "@/components/nav/BoatFab";
import { SideNav } from "@/components/nav/SideNav";

// Every page that isn't the map shares this chrome: the persistent
// sidebar on wide screens, and the boat-button drawer everywhere else,
// so navigation never requires going back to the map first.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SideNav />
      {children}
      <BoatFab />
    </>
  );
}
