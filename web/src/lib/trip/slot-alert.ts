// Which route alert explains a cancelled slot. WSF names times in its
// bulletins three ways - "0405" (the notifier's cancellation grammar),
// "04:05", and the spoken "4:05" - so a slot is matched by any of those
// forms as a whole token, never as a substring of another number. A tidal
// cancel with no time match falls back to the bulletin that mentions the
// tide: WSF publishes those as one seasonal notice covering many slots.

import type { AlertItem } from "./types";

function timeForms(hhmm: string): string[] {
  const [h, m] = hhmm.split(":") as [string, string];
  const h12 = String(((Number(h) + 11) % 12) + 1);
  return [`${h}${m}`, `${h}:${m}`, `${h12}:${m}`];
}

function mentionsTime(haystack: string, hhmm: string): boolean {
  return timeForms(hhmm).some((form) =>
    new RegExp(`(^|[^0-9:])${form.replace(":", "\\:")}([^0-9:]|$)`).test(haystack),
  );
}

const TIDAL = /\btid(al|e|es)\b|low water/i;

/** The alert to link from a cancelled slot, or null when none explains it. */
export function alertForSlot(
  slot: { time_local: string; tidal: boolean },
  alerts: readonly AlertItem[],
): AlertItem | null {
  const text = (a: AlertItem) => `${a.title}\n${a.text ?? ""}`;
  return (
    alerts.find((a) => mentionsTime(text(a), slot.time_local)) ??
    (slot.tidal ? (alerts.find((a) => TIDAL.test(text(a))) ?? null) : null)
  );
}
