// The Paper Sound weather glyph artwork, as markup strings - the ONE
// source both renderers share: WeatherIcon (React, trip pages) and the
// map's terminal chips (plain DOM markers). Keyed by the poller's icon
// tokens; an unknown token draws the cloud - weather must never be an
// empty box.

const CLOUD = "M7 17h9a3.5 3.5 0 0 0 .6-6.95 5 5 0 0 0-9.7-.9A3.9 3.9 0 0 0 7 17Z";
const SUN_RAYS =
  "M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4";

const GLYPHS: Record<string, string> = {
  clear: `<circle cx="12" cy="12" r="4.2"/><path d="${SUN_RAYS}"/>`,
  "mostly-clear": `<circle cx="10" cy="10" r="3.6"/><path d="M10 3.4v1.6M3.4 10h1.6M5.4 5.4l1.1 1.1"/><path d="M12 19h6a2.8 2.8 0 0 0 .5-5.55 4 4 0 0 0-7.3-1.1"/>`,
  partly: `<circle cx="9" cy="9" r="3.2"/><path d="M9 3.6v1.4M3.6 9h1.4M5.2 5.2l1 1"/><path d="${CLOUD}" transform="translate(3 2) scale(0.78)"/>`,
  cloudy: `<path d="${CLOUD}"/>`,
  fog: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M5.5 17.5h13M7.5 20.5h9"/>`,
  smoke: `<path d="M5 19c2-1 4-1 6 0s4 1 6 0M5 15.5c2-1 4-1 6 0s4 1 6 0M5 12c2-1 4-1 6 0s4 1 6 0"/><path d="M8.5 8.5c0-2 2.2-2 2.2-4"/>`,
  rain: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M8 17.5v3M12 17.5v3M16 17.5v3"/>`,
  showers: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>`,
  tstorm: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M12.5 15.5 10 19h3l-2 3.5"/>`,
  snow: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M8 18.2v.1M12 19.6v.1M16 18.2v.1M10 21v.1M14 21v.1" stroke-width="2.2"/>`,
  sleet: `<path d="${CLOUD}" transform="translate(0 -2.5) scale(0.9)"/><path d="M8 17.5v2.8M16 17.5v2.8"/><path d="M12 19.2v.1" stroke-width="2.2"/>`,
  wind: `<path d="M3.5 9h10a2.4 2.4 0 1 0-2.4-2.6M3.5 13h14.2a2.4 2.4 0 1 1-2.4 2.6M3.5 17h7"/>`,
  hot: `<path d="M10.5 4.5v9.2a3.2 3.2 0 1 0 3 0V9"/><path d="M12 6.8v8.5" stroke-width="2.4"/><path d="M17.5 5.5h3M17.5 8.5h2"/>`,
  cold: `<path d="M12 3.5v17M12 3.5 10 5.6M12 3.5l2 2.1M12 20.5 10 18.4M12 20.5l2-2.1"/><path d="M4.6 7.75l14.8 8.5M4.6 7.75l2.85.35M4.6 7.75l.35-2.85M19.4 16.25l-2.85-.35M19.4 16.25l-.35 2.85"/><path d="M19.4 7.75 4.6 16.25M19.4 7.75l-2.85.35M19.4 7.75l-.35-2.85M4.6 16.25l2.85-.35M4.6 16.25l.35 2.85"/>`,
};

export function glyphMarkup(token: string, size: number): string {
  const body = GLYPHS[token] ?? GLYPHS.cloudy!;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.6" ` +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}
