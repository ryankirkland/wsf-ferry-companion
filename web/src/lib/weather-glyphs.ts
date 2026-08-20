// The Paper Sound weather glyphs - FLAT and colorful (owner's call,
// 2026-08-20: the stroke-drawn set was "very hard to decipher" at chip
// sizes, and the map's whole language is flat color shapes). One source
// for both renderers: WeatherIcon (React, trip pages) and the map's
// DOM-built terminal chips. Fixed palette chosen to read on the day
// paper AND the night water - no theme tokens, weather has its own
// colors the way the boats have theirs. An unknown token draws the
// cloud: weather must never be an empty box.

const SUN = "#f0b429";
const CLOUD = "#b9c4c0";
const CLOUD_SHADE = "#9daaa6";
const RAIN = "#4f97c9";
const SNOW = "#bfe0f2";
const FOG = "#9aa8a4";
const WIND = "#5f9ea8";
const HOT = "#e5674b";
const COLD = "#7fb8d9";
const SMOKE = "#98938b";

const CLOUD_PATH =
  '<path d="M7 17.5h9.5a3.75 3.75 0 0 0 .64-7.44 5.3 5.3 0 0 0-10.28-.96A4.14 4.14 0 0 0 7 17.5Z"';
const SMALL_CLOUD =
  '<path d="M10.5 19h8a3.1 3.1 0 0 0 .53-6.15 4.4 4.4 0 0 0-8.53-.8A3.44 3.44 0 0 0 10.5 19Z"';

const sunDisc = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>` +
  `<g stroke="${SUN}" stroke-width="2.2" stroke-linecap="round">` +
  `<path d="M${cx} ${cy - r - 4.4}v2.2M${cx} ${cy + r + 2.2}v2.2M${cx - r - 4.4} ${cy}h2.2M${cx + r + 2.2} ${cy}h2.2"/>` +
  `<path d="M${cx - (r + 2.8) * 0.707} ${cy - (r + 2.8) * 0.707}l1.55 1.55M${cx + (r + 1.2) * 0.707} ${cy + (r + 1.2) * 0.707}l1.55 1.55M${cx + (r + 2.8) * 0.707} ${cy - (r + 2.8) * 0.707}l-1.55 1.55M${cx - (r + 1.2) * 0.707} ${cy + (r + 1.2) * 0.707}l1.55 -1.55"/></g>`;

const drop = (x: number, y: number) =>
  `<path d="M${x} ${y}c-1.1 1.7-1.65 2.75-1.65 3.6a1.65 1.65 0 0 0 3.3 0c0-.85-.55-1.9-1.65-3.6Z" fill="${RAIN}"/>`;

const dot = (x: number, y: number, r = 1.5, fill = SNOW) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

const GLYPHS: Record<string, string> = {
  clear: sunDisc(12, 12, 4.6),
  "mostly-clear":
    sunDisc(9.5, 9.5, 4) + `${SMALL_CLOUD} fill="${CLOUD}"/>`,
  partly:
    sunDisc(8.5, 8.5, 3.6) + `${CLOUD_PATH} fill="${CLOUD}" transform="translate(2.5 2) scale(0.85)"/>`,
  cloudy: `${CLOUD_PATH} fill="${CLOUD}"/><path d="M7 17.5h9.5a3.75 3.75 0 0 0 1.5-.32H6a4.1 4.1 0 0 0 1 .32Z" fill="${CLOUD_SHADE}"/>`,
  fog:
    `${CLOUD_PATH} fill="${CLOUD}" transform="translate(0.5 -4) scale(0.92)"/>` +
    `<g stroke="${FOG}" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 18h13M7.5 21.5h9"/></g>`,
  smoke:
    `<g stroke="${SMOKE}" stroke-width="2.6" stroke-linecap="round" fill="none">` +
    `<path d="M5 18.5c2.3-1.2 4.7-1.2 7 0s4.7 1.2 7 0M5 14c2.3-1.2 4.7-1.2 7 0s4.7 1.2 7 0M5 9.5c2.3-1.2 4.7-1.2 7 0s4.7 1.2 7 0"/></g>`,
  rain:
    `${CLOUD_PATH} fill="${CLOUD}" transform="translate(0 -3) scale(0.95)"/>` +
    drop(8, 16.5) + drop(12.5, 17.5) + drop(17, 16.5),
  showers:
    `${CLOUD_PATH} fill="${CLOUD}" transform="translate(0 -3) scale(0.95)"/>` +
    `<g stroke="${RAIN}" stroke-width="2.4" stroke-linecap="round"><path d="M8.5 16.5l-1.2 3.2M13 16.5l-1.2 3.2M17.5 16.5l-1.2 3.2"/></g>`,
  tstorm:
    `${CLOUD_PATH} fill="${CLOUD_SHADE}" transform="translate(0 -3) scale(0.95)"/>` +
    `<path d="M13.4 13.5 9.8 18.6h2.9l-2 4.4 5.5-6.1h-2.9l2-3.4Z" fill="${SUN}"/>`,
  snow:
    `${CLOUD_PATH} fill="${CLOUD}" transform="translate(0 -3) scale(0.95)"/>` +
    dot(8, 17.5, 1.7) + dot(12.5, 19.5, 1.7) + dot(17, 17.5, 1.7) + dot(10.2, 21.3, 1.4) + dot(14.8, 21.3, 1.4),
  sleet:
    `${CLOUD_PATH} fill="${CLOUD}" transform="translate(0 -3) scale(0.95)"/>` +
    drop(8.5, 16.5) + dot(12.7, 18.5, 1.7) + drop(16.5, 16.5),
  wind:
    `<g stroke="${WIND}" stroke-width="2.6" stroke-linecap="round" fill="none">` +
    `<path d="M3.5 9.5h9.8a2.6 2.6 0 1 0-2.6-2.8M3.5 14h14a2.6 2.6 0 1 1-2.6 2.8M3.5 18.5h7.5"/></g>`,
  hot:
    `<rect x="10.4" y="4" width="3.2" height="11" rx="1.6" fill="#e8e3da"/>` +
    `<rect x="11.2" y="7" width="1.6" height="8.4" fill="${HOT}"/>` +
    `<circle cx="12" cy="17.4" r="3.4" fill="${HOT}"/>` +
    `<g stroke="${HOT}" stroke-width="1.8" stroke-linecap="round"><path d="M17.5 5.5h3M17.5 8.8h2"/></g>`,
  cold:
    `<g stroke="${COLD}" stroke-width="2.2" stroke-linecap="round">` +
    `<path d="M12 3.8v16.4M4.9 7.9l14.2 8.2M19.1 7.9 4.9 16.1"/></g>` +
    dot(12, 12, 2.2, COLD),
};

export function glyphMarkup(token: string, size: number): string {
  const body = GLYPHS[token] ?? GLYPHS.cloudy!;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none">` +
    body +
    `</svg>`
  );
}
