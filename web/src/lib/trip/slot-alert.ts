// Which route alert explains a cancelled slot. WSF names times in its
// bulletins three ways - "0405" (the notifier's cancellation grammar),
// "04:05", and the spoken "4:05" - so a slot is matched by any of those
// forms as a whole token, never as a substring of another number. A tidal
// cancel with no time match falls back to the bulletin that mentions the
// tide: WSF publishes those as one seasonal notice covering many slots.

import type { AlertItem } from "./types";

/** The three spellings, each as a whole token. The spoken form may carry
 * a meridiem ("4:05 p.m.", "4:05pm"); when it does it must agree with the
 * slot, so a 16:05 cancel never links a bulletin about the 4:05 a.m. */
function mentionsTime(haystack: string, hhmm: string): boolean {
  const [h, m] = hhmm.split(":") as [string, string];
  const hour = Number(h);
  const h12 = String(((hour + 11) % 12) + 1);
  const meridiem = hour < 12 ? "a" : "p";
  const token = (form: string) => new RegExp(`(^|[^0-9:])${form}([^0-9:]|$)`);
  if (token(`${h}${m}`).test(haystack) || token(`${h}:${m}`).test(haystack)) return true;
  const spoken = new RegExp(`(^|[^0-9:])${h12}:${m}(?:\\s*([ap])\\.?m\\b\\.?)?(?![0-9:])`, "i");
  const hit = spoken.exec(haystack);
  return hit !== null && (hit[2] === undefined || hit[2].toLowerCase() === meridiem);
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
