// F6 weather: /data/weather.json fetch-once-with-TTL cache plus the
// honesty helpers. The governing rules: a forecast row exists only
// inside NWS's published horizon (beyond it the UI shows NOTHING),
// and `as_of` is the forecasters' publish time - staleness is the
// reader's to judge, so it is always surfaced to components.

import { DATA_BASE, DATA_MODE } from "@/config";
import { resolveTripTemplate } from "@/lib/trip/fixture-template";

export const WEATHER_PATH = "/data/weather.json";
const TTL_MS = 10 * 60_000; // the poller publishes every 30 min

/** [epoch_ms, temp_f, icon, pop_pct, wind_mph, wind_dir, short] */
export type HourRow = [number, number | null, string, number, number | null, string, string];

export interface TerminalAqi {
  aqi: number;
  category: string;
  pollutant: string;
  area: string;
  /** The monitor that set the AQI - it can sit up to 50 miles away. */
  site?: string | null;
  observed_date: string;
  observed_hour: number;
  /** ISO UTC observation time. Absent on entries written before the
   *  2026-10-24 AirNow migration, which are never current. */
  observed_at?: string;
}

export interface TerminalWx {
  name: string;
  as_of?: string;
  hours?: HourRow[];
  aqi?: TerminalAqi | null;
  unavailable?: string;
}

export interface WeatherDoc {
  v: number;
  generated_at: string;
  terminals: Record<string, TerminalWx>;
}

let cache: { doc: WeatherDoc | null; at: number } | null = null;
let inflight: Promise<WeatherDoc | null> | null = null;

async function load(): Promise<WeatherDoc | null> {
  try {
    if (process.env.NODE_ENV === "development" && DATA_MODE === "fixture") {
      const res = await fetch("/dev-fixtures/weather.template.json", { cache: "no-store" });
      if (!res.ok) return null;
      return JSON.parse(resolveTripTemplate(await res.text(), Date.now())) as WeatherDoc;
    }
    const res = await fetch(`${DATA_BASE}${WEATHER_PATH}`, { cache: "no-store" });
    if (!res.ok) return null;
    const doc = (await res.json()) as WeatherDoc;
    return doc.v === 1 && doc.terminals ? doc : null;
  } catch {
    return null;
  }
}

/** Cached fetch: weather absent (pipeline down, first deploy, offline)
 *  resolves null and every consumer renders nothing - honest absence. */
export function getWeather(): Promise<WeatherDoc | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.doc);
  if (!inflight) {
    inflight = load().then((doc) => {
      cache = { doc, at: Date.now() };
      inflight = null;
      return doc;
    });
  }
  return inflight;
}

/** The forecast hour containing `ms`, or null outside the published
 *  horizon - the "show nothing past ~6.5 days" rule lives here. */
export function hourFor(t: TerminalWx | undefined, ms: number): HourRow | null {
  if (!t?.hours?.length) return null;
  const first = t.hours[0]![0];
  const last = t.hours[t.hours.length - 1]![0];
  if (ms < first - 3_600_000 || ms > last + 3_600_000) return null;
  let best: HourRow | null = null;
  for (const row of t.hours) {
    if (row[0] <= ms) best = row;
    else break;
  }
  return best ?? t.hours[0]!;
}

/** Conditions right now: NWS's first hourly period IS the current hour. */
export function nowRow(t: TerminalWx | undefined): HourRow | null {
  return t?.hours?.[0] ?? null;
}

/** Mirrors the poller's AQI_MAX_AGE: past this, a reading is not
 *  "current air quality" and is not shown. */
export const AQI_MAX_AGE_MS = 3 * 3_600_000;
/** Mirrors AQI_MAX_FUTURE_SKEW: a reading stamped further ahead than
 *  this is a bad stamp, not a forecast. */
export const AQI_MAX_FUTURE_MS = 3_600_000;
// The poller writes exactly this shape. Date.parse alone is not a check:
// V8 reads junk like "%%ISO-40%%" as the year 2040, which a one-sided
// age test then accepts as current (found by PR #189's review).
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The terminal's AQI only while it is current, else null. The poller
 *  already withdraws old readings; this guards the case it cannot - a
 *  pipeline that stopped publishing leaves its last file in place, and
 *  the 2026-10-01 AirNow retirement showed one 3 a.m. reading as current
 *  for 23 days. */
export function currentAqi(t: TerminalWx | undefined, nowMs: number): TerminalAqi | null {
  const aqi = t?.aqi;
  if (!aqi?.observed_at || !ISO_UTC.test(aqi.observed_at)) return null;
  const ageMs = nowMs - Date.parse(aqi.observed_at);
  return ageMs >= -AQI_MAX_FUTURE_MS && ageMs <= AQI_MAX_AGE_MS ? aqi : null;
}

/** EPA AQI category -> the token pair the chips color themselves with.
 *  Thresholds are the EPA's, not ours. */
export function aqiTone(aqi: number): "good" | "moderate" | "usg" | "unhealthy" | "severe" {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "usg";
  if (aqi <= 200) return "unhealthy";
  return "severe";
}
