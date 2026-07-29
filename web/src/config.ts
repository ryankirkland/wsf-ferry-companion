// Build-time configuration; every value overridable via NEXT_PUBLIC_* env.

const env = process.env;

export const STYLE_URL =
  env.NEXT_PUBLIC_STYLE_URL ?? "https://ferrysound.com/assets/style/positron-v1.json";

export const DATA_BASE = env.NEXT_PUBLIC_DATA_BASE ?? "";
export const DATA_MODE =
  env.NEXT_PUBLIC_DATA_MODE ?? (env.NODE_ENV === "development" ? "fixture" : "live");

export const FLEET_PATH = "/data/fleet.json";
export const DIMS_PATH = "/data/vessels.json";
export const TERMINALS_PATH = "/data/terminals.json";

export const POLL_MS = 12_000;
export const POLL_JITTER_MS = 2_000;

// The Sound, framed: bounds and padding proven in the design prototype.
export const SOUND_BOUNDS: [[number, number], [number, number]] = [
  [-122.72, 47.52],
  [-122.3, 47.85],
];
export const FIT_PADDING = { top: 80, bottom: 110, left: 40, right: 40 };

export const DECLUTTER_ZOOM = 10.2;
export const STALE_S = 300;
export const SOUND_TZ = "America/Los_Angeles";
