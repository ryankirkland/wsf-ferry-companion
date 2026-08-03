// M5 admin analytics contract: /v1/admin/analytics. Same discipline as the
// stats + trip contracts (lib/stats/types.ts) - a payload that fails its
// guard is dropped entirely, and the dashboard says so honestly rather
// than half-rendering with a doc that doesn't match its own shape.

export interface AdminAnalyticsDay {
  date: string;
  pageviews: number;
  ambient_pageviews: number;
  clicks: number;
}

export interface AdminAnalyticsMonth {
  month: string;
  unique_visitors: number;
  returning_visitors: number;
  days_covered: number;
}

export interface AdminAnalyticsCount {
  count: number;
}

export interface TopPage extends AdminAnalyticsCount {
  path: string;
}

export interface TopClick extends AdminAnalyticsCount {
  label: string;
}

export interface Referrer extends AdminAnalyticsCount {
  source: string;
}

export interface GeoRow extends AdminAnalyticsCount {
  country: string;
  region: string;
  city: string;
}

export interface AdminAnalyticsSummary {
  v: 1;
  generated_at: string;
  range: { from: string; to: string };
  by_day: AdminAnalyticsDay[];
  by_month: AdminAnalyticsMonth[];
  top_pages: TopPage[];
  top_clicks: TopClick[];
  referrers: Referrer[];
  geo: GeoRow[];
  missing_days: string[];
  missing_months: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDay(value: unknown): value is AdminAnalyticsDay {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.pageviews === "number" &&
    typeof value.ambient_pageviews === "number" &&
    typeof value.clicks === "number"
  );
}

function isMonth(value: unknown): value is AdminAnalyticsMonth {
  return (
    isRecord(value) &&
    typeof value.month === "string" &&
    typeof value.unique_visitors === "number" &&
    typeof value.returning_visitors === "number" &&
    typeof value.days_covered === "number"
  );
}

function isCounted(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "string" && typeof value.count === "number";
}

function isGeoRow(value: unknown): value is GeoRow {
  return (
    isRecord(value) &&
    typeof value.country === "string" &&
    typeof value.region === "string" &&
    typeof value.city === "string" &&
    typeof value.count === "number"
  );
}

export function isAdminAnalyticsSummary(value: unknown): value is AdminAnalyticsSummary {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.generated_at !== "string") return false;
  if (!isRecord(value.range) || typeof value.range.from !== "string" || typeof value.range.to !== "string") {
    return false;
  }
  if (!Array.isArray(value.by_day) || !value.by_day.every(isDay)) return false;
  if (!Array.isArray(value.by_month) || !value.by_month.every(isMonth)) return false;
  if (!Array.isArray(value.top_pages) || !value.top_pages.every((r) => isCounted(r, "path"))) return false;
  if (!Array.isArray(value.top_clicks) || !value.top_clicks.every((r) => isCounted(r, "label"))) return false;
  if (!Array.isArray(value.referrers) || !value.referrers.every((r) => isCounted(r, "source"))) return false;
  if (!Array.isArray(value.geo) || !value.geo.every(isGeoRow)) return false;
  if (!Array.isArray(value.missing_days) || !value.missing_days.every((d) => typeof d === "string")) {
    return false;
  }
  if (!Array.isArray(value.missing_months) || !value.missing_months.every((m) => typeof m === "string")) {
    return false;
  }
  return true;
}
