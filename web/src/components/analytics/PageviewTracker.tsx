"use client";

// The one place click tracking lives. A pageview fires on every path
// change; clicks are caught by a single delegated listener that walks up
// to the nearest [data-analytics-label] - instrumenting a new element is
// adding that attribute, not wiring another onClick handler here.

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackClick, trackPageview } from "@/lib/analytics/beacon";

export function PageviewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageview(pathname, pathname.startsWith("/ambient"));
  }, [pathname]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest("[data-analytics-label]");
      const label = el?.getAttribute("data-analytics-label");
      if (label) trackClick(label, window.location.pathname.startsWith("/ambient"));
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return null;
}
