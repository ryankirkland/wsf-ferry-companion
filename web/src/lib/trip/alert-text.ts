// WSF publishes two strings per bulletin: AlertFullTitle (our `title`) and
// RouteAlertText (our `text`). For most bulletins they are the same sentence
// typed twice - "Sea/Brem - ADA Alert - Chimacum #2 Elevator Out of Service"
// above an identical grey line - and the copies drift only in punctuation and
// spacing ("Edm/King- Boarding" vs "Edm/King - Boarding"), so a raw string
// compare misses them. Some bulletins DO carry the real same-day truth in
// RouteAlertText ("The 0405 VASH>FAU ... are cancelled"), which is what the
// notifier parses cancellations out of, so this only suppresses text that
// says nothing the title has not already said.

/** Case, punctuation and whitespace folded away - "Edm/King- Vessel #1" and
 * "Edm/King - Vessel #1." collapse to the same key. Keeps digits so "#1" and
 * "#2" never fold together. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The alert's body to render under its title, or null when the body would
 * just repeat the title. */
export function alertBody(alert: { title: string; text: string | null }): string | null {
  const text = alert.text?.trim();
  if (!text) return null;
  const body = fold(text);
  if (body.length === 0) return null;
  const title = fold(alert.title);
  // Equal (the common case), or a shorter restatement the title fully covers.
  if (body === title || title.includes(body)) return null;
  return text;
}
