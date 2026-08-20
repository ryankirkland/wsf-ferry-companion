"use client";

// The trip page's weather answer: both ends of the crossing at the hour
// of the sailing being viewed ("what will Seattle be like when I land
// and walk to the bus"). Honesty rules live in lib/data/weather:
// outside the forecast horizon this renders NOTHING, and a stale as_of
// gets said out loud rather than hidden.

import { useEffect, useState } from "react";
import {
  aqiTone,
  getWeather,
  hourFor,
  type TerminalWx,
  type WeatherDoc,
} from "@/lib/data/weather";
import { WeatherIcon } from "./WeatherIcon";
import styles from "./weather.module.css";

const STALE_FORECAST_MS = 12 * 3_600_000; // NWS updates a few times a day

export function WeatherStrip({
  dep,
  arr,
  atMs,
  nowMs,
}: {
  dep: number;
  arr: number;
  /** The sailing being viewed; the strip describes THIS hour. */
  atMs: number | null;
  /** The page's clock (useNow upstream) - render-pure staleness math. */
  nowMs: number;
}) {
  const [doc, setDoc] = useState<WeatherDoc | null>(null);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      void getWeather().then((d) => alive && setDoc(d));
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  if (!doc || atMs === null) return null;
  const ends = [doc.terminals[String(dep)], doc.terminals[String(arr)]].filter(
    (t): t is TerminalWx => !!t,
  );
  const rows = ends.map((t) => ({ t, row: hourFor(t, atMs) }));
  // Outside the horizon (or wholly uncovered): honest absence, no strip.
  if (!rows.some((r) => r.row)) return null;

  const stalest = Math.min(
    ...rows.filter((r) => r.row && r.t.as_of).map((r) => Date.parse(r.t.as_of!)),
  );

  return (
    <div className={styles.strip} data-testid="weather-strip">
      {rows.map(({ t, row }) =>
        row ? (
          <span key={t.name} className={styles.place}>
            <span className={styles.placeName}>{t.name}</span>
            <WeatherIcon token={row[2]} />
            {row[1] !== null && <strong>{row[1]}°</strong>}
            <span className={styles.detail}>{row[6]}</span>
            {row[3] >= 15 && <span className={styles.detail}>{row[3]}% rain</span>}
            {row[4] !== null && row[4] >= 12 && (
              <span className={styles.detail}>
                {row[5] && `${row[5]} `}
                {row[4]} mph
              </span>
            )}
            {t.aqi && (
              <span
                className={`${styles.aqi} ${styles[`aqi-${aqiTone(t.aqi.aqi)}`]}`}
                title={`Air quality (${t.aqi.pollutant}, ${t.aqi.area})`}
              >
                AQI {t.aqi.aqi} {t.aqi.category}
              </span>
            )}
          </span>
        ) : (
          <span key={t.name} className={styles.place}>
            <span className={styles.placeName}>{t.name}</span>
            <span className={styles.detail}>{t.unavailable ?? "no forecast"}</span>
          </span>
        ),
      )}
      {Number.isFinite(stalest) && nowMs - stalest > STALE_FORECAST_MS && (
        <span className={styles.stale}>
          forecast from {new Date(stalest).toLocaleString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
          })}
        </span>
      )}
    </div>
  );
}
