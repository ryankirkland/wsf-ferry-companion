// Fire-and-forget analytics beacon. A dropped or failed beacon must never
// break the page for the user - every path here is wrapped so a beacon
// failure is invisible, not a console error or a broken click.

import { EVENTS_PATH } from "@/config";
import { ANALYTICS_OPTOUT_KEY, readStorage } from "@/lib/storage";

type EventBody = {
  type: "pageview" | "click";
  path: string | null;
  referrer: string | null;
  label: string | null;
  ambient: boolean;
};

// Callers already guard SSR (typeof window === "undefined"), so this only
// ever runs in the browser.
function send(body: EventBody): void {
  if (readStorage(ANALYTICS_OPTOUT_KEY) === "1") return;
  const payload = JSON.stringify(body);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(EVENTS_PATH, new Blob([payload], { type: "application/json" }));
  } else {
    void fetch(EVENTS_PATH, {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }
}

export function trackPageview(path: string, ambient: boolean): void {
  if (typeof window === "undefined") return;
  try {
    send({ type: "pageview", path, referrer: document.referrer || null, label: null, ambient });
  } catch {
    // A beacon must never break the page it's measuring.
  }
}

export function trackClick(label: string, ambient: boolean): void {
  if (typeof window === "undefined") return;
  try {
    send({ type: "click", path: window.location.pathname, referrer: null, label, ambient });
  } catch {
    // A beacon must never break the page it's measuring.
  }
}
