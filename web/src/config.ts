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
// Top padding clears the masthead + mode switcher, which float over the
// map: at 80 the Clinton terminal label landed under the switcher pill.
export const FIT_PADDING = { top: 124, bottom: 110, left: 40, right: 40 };

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
export const ADJUSTMENTS_PATH = "/data/adjustments.json";
export const pairDayPath = (dep: number, arr: number, date: string) =>
  `/data/pairs/${dep}-${arr}/${date}.json`;
export const pairFaresPath = (dep: number, arr: number) => `/data/fares/${dep}-${arr}.json`;

// M3 alerts: Cognito identifiers are public client config, not secrets.
export const API_ORIGIN = env.NEXT_PUBLIC_API_ORIGIN ?? "https://api.ferrysound.com";
export const COGNITO_POOL_ID = env.NEXT_PUBLIC_COGNITO_POOL_ID ?? "us-west-2_Rvw5RQOP0";
export const COGNITO_CLIENT_ID =
  env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "57ckrpr8h75p2hrpf72so0leu7";

// M4 stats + capacity contracts (materialized nightly / every minute).
export const STATS_SUMMARY_PATH = "/data/stats/summary.json";
export const CAPACITY_PATH = "/data/capacity.json";
export const pairStatsPath = (dep: number, arr: number) => `/data/stats/pairs/${dep}-${arr}.json`;
// Capacity readings older than this are labeled, never silently shown as now.
export const CAPACITY_STALE_MS = 240_000;
export const STATS_REFRESH_MS = 3_600_000;
export const CAPACITY_POLL_MS = 60_000;
