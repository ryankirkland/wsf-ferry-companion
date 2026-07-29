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

// Trip planner (M2). Signal thresholds in minutes: green > 25, amber
// 10-25, red <= 10 or running late. Delta display capped so a stale or
// nonsense LeftDock never renders "sailed +7319 min".
export const SIGNAL = {
  comfortableMin: 25,
  tightMin: 10,
  goneAfterMin: 3,
  lateStartSlackMin: 5,
  minDeltaMin: 1,
  maxDeltaMin: 120,
  countdownMaxMin: 120,
};

export const TRIP_HORIZON_DAYS = 14;
export const PAIR_REFRESH_MS = 300_000;
export const ALERTS_POLL_MS = 60_000;
export const PAIRS_INDEX_PATH = "/data/pairs/index.json";
export const ALERTS_PATH = "/data/alerts.json";
export const pairDayPath = (dep: number, arr: number, date: string) =>
  `/data/pairs/${dep}-${arr}/${date}.json`;
export const pairFaresPath = (dep: number, arr: number) => `/data/fares/${dep}-${arr}.json`;
