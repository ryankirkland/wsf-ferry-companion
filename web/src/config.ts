// Build-time configuration; every value overridable via NEXT_PUBLIC_* env.
//
// Each read MUST be the literal `process.env.NEXT_PUBLIC_X` member
// expression: the bundler substitutes exactly that form at build time.
// Aliasing (`const env = process.env`) silently breaks every override AND
// keeps dev-fixture code alive in production bundles (found by the Vercel
// best-practices audit: bundle-analyzable-paths).

export const STYLE_URL =
  process.env.NEXT_PUBLIC_STYLE_URL ?? "https://soundferries.com/assets/style/positron-v1.json?v=2";

export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "";
// Fixtures are a DEVELOPMENT affordance. Every consumer tests
// `process.env.NODE_ENV === "development" && DATA_MODE === "fixture"` with
// the NODE_ENV read written out literally in that module: the bundler only
// folds constants within a module, so the local literal is what lets
// `false && ...` collapse and the fixture fetchers tree-shake out of
// production chunks entirely.
export const DATA_MODE =
  process.env.NEXT_PUBLIC_DATA_MODE ??
  (process.env.NODE_ENV === "development" ? "fixture" : "live");

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

// Sailing schedule (M2). Signal thresholds in minutes: green > 25, amber
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
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "https://api.soundferries.com";
export const COGNITO_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_POOL_ID ?? "us-west-2_Rvw5RQOP0";
export const COGNITO_CLIENT_ID =
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "57ckrpr8h75p2hrpf72so0leu7";

// M4 stats + capacity contracts (materialized nightly / every minute).
export const STATS_SUMMARY_PATH = "/data/stats/summary.json";
export const CAPACITY_PATH = "/data/capacity.json";
export const pairStatsPath = (dep: number, arr: number) => `/data/stats/pairs/${dep}-${arr}.json`;
// Capacity readings older than this are labeled, never silently shown as now.
export const CAPACITY_STALE_MS = 240_000;
export const STATS_REFRESH_MS = 3_600_000;
export const CAPACITY_POLL_MS = 60_000;

// M5 site analytics. EVENTS_PATH is relative - it goes through the same
// CloudFront distribution as the page itself, NOT API_ORIGIN, so CloudFront
// can attach geo headers server-side. Must stay a same-origin relative path.
export const EVENTS_PATH = "/v1/events";
// Cross-origin like /v1/subscriptions, since it doesn't need geo resolution.
export const ADMIN_ANALYTICS_PATH = "/v1/admin/analytics";
