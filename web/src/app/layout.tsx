import type { Metadata } from "next";
import localFont from "next/font/local";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
import { ConstructionNotice } from "@/components/chrome/ConstructionNotice";
import { DataNotice } from "@/components/chrome/DataNotice";
import { PageviewTracker } from "@/components/analytics/PageviewTracker";
import noticeStyles from "@/components/chrome/notices.module.css";
import "@/styles/tokens.css";
import "./globals.css";

const gabarito = localFont({
  src: "../fonts/gabarito-latin-wght-normal.woff2",
  variable: "--font-gabarito",
  weight: "400 900",
  display: "swap",
});

const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ferry Sound",
  description:
    "A live map of the Washington State Ferries fleet on Puget Sound - honest, beautiful, always on.",
};

// Pre-hydration mode stamp so a night-time visitor never flashes daylight.
// Mirrors autoMode() in lib/time/sound-time.ts; keep the two in sync.
const modeScript = `(function(){try{
var h=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",hour:"numeric",hour12:false}).format(new Date()))%24;
var m=(h>=7&&h<17)?"day":((h>=17&&h<21)||(h>=5&&h<7))?"dusk":"night";
document.documentElement.dataset.mode=m;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-hydration script legitimately changes
    // data-mode before React attaches (the standard theme-stamp pattern).
    <html
      lang="en"
      data-mode="day"
      suppressHydrationWarning
      className={`${gabarito.variable} ${inter.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: modeScript }} />
      </head>
      <body>
        {children}
        <PageviewTracker />
        <div className={noticeStyles.stack}>
          <DataNotice />
          <ConsentBanner />
        </div>
        <ConstructionNotice />
      </body>
    </html>
  );
}
