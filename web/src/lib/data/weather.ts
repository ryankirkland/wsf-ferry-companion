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
  observed_date: string;
  observed_hour: number;
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

/** EPA AQI category -> the token pair the chips color themselves with.
 *  Thresholds are the EPA's, not ours. */
export function aqiTone(aqi: number): "good" | "moderate" | "usg" | "unhealthy" | "severe" {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "usg";
  if (aqi <= 200) return "unhealthy";
  return "severe";
}
