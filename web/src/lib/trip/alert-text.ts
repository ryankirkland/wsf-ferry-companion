// WSF publishes three strings per bulletin: AlertFullTitle (our `title`),
// RouteAlertText (our `text`) and BulletinText (our `body`, ingested since
// 2026-09-03). For most bulletins title and text are the same sentence typed
// twice - "Sea/Brem - ADA Alert - Chimacum #2 Elevator Out of Service" above
// an identical grey line - and the copies drift only in punctuation and
// spacing ("Edm/King- Boarding" vs "Edm/King - Boarding"), so a raw string
// compare misses them. Some bulletins DO carry the real same-day truth in
// RouteAlertText ("The 0405 VASH>FAU ... are cancelled"), which is what the
// notifier parses cancellations out of, and the body is where the substance
// of a status bulletin lives. This keeps every text that says something the
// title has not already said. The alert email applies the same rule
// (libs/wsf-core/src/wsf_core/alert_text.py) - keep the two in lockstep.

/** Case, punctuation and whitespace folded away - "Edm/King- Vessel #1" and
 * "Edm/King - Vessel #1." collapse to the same key. Keeps digits so "#1" and
 * "#2" never fold together. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The texts to render under an alert's title, in order (text, then body):
 * a candidate is dropped when the title covers it, when another candidate
 * strictly contains it (the body usually restates the one-liner in full),
 * or when an earlier candidate equals it. Empty when nothing adds to the
 * title. Never drops a text that EXTENDS the title - that is where the
 * cancellations live. */
export function alertDetails(alert: {
  title: string;
  text: string | null;
  body?: string | null;
}): string[] {
  const candidates = [alert.text, alert.body].map((c) => (c ?? "").trim());
  const keys = candidates.map(fold);
  const titleKey = fold(alert.title);
  return candidates.filter((_, i) => {
    const key = keys[i]!;
    if (key.length === 0 || titleKey.includes(key)) return false;
    return !keys.some((other, j) => j !== i && other.includes(key) && (other !== key || j < i));
  });
}
