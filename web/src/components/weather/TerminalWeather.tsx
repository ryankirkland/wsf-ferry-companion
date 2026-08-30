"use client";

// The trip page's weather answer, worn by the h1 itself: each terminal
// name in "Bremerton → Seattle" carries its conditions at the hour of
// the sailing being viewed ("what will Seattle be like when I land and
// walk to the bus"). The page shell server-renders the h1 (the static
// export needs a real document body), so this client component portals
// compact chips into the empty slot spans the shell leaves beside each
// name - there is no separate weather section anymore.
//
// Honesty rules live in lib/data/weather and survive the move: outside
// the forecast horizon (or where coverage is unavailable) a slot simply
// stays empty, and a stale as_of is still said out loud - as a small
// note rendered where the old strip sat, since it describes both ends.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  aqiTone,
  getWeather,
  hourFor,
  type HourRow,
  type TerminalWx,
  type WeatherDoc,
} from "@/lib/data/weather";
import { WeatherIcon } from "./WeatherIcon";
import styles from "./weather.module.css";

const STALE_FORECAST_MS = 12 * 3_600_000; // NWS updates a few times a day

export const DEP_SLOT_ID = "wx-slot-dep";
export const ARR_SLOT_ID = "wx-slot-arr";

function chipTitle(row: HourRow, t: TerminalWx): string {
  const parts: string[] = [row[6]];
  if (row[4] !== null && row[4] >= 12) parts.push(`${row[5] ? `${row[5]} ` : ""}${row[4]} mph`);
  if (row[3] >= 15) parts.push(`${row[3]}% chance of rain`);
  if (t.aqi) parts.push(`AQI ${t.aqi.aqi} ${t.aqi.category} (${t.aqi.pollutant}, ${t.aqi.area})`);
  return parts.join(" · ");
}

function Chip({ t, row }: { t: TerminalWx; row: HourRow }) {
  return (
    <span className={styles.wxChip} title={chipTitle(row, t)} data-testid={`wx-${t.name}`}>
      <WeatherIcon token={row[2]} size={26} />
      {row[1] !== null && <strong>{row[1]}°</strong>}
      {row[3] >= 15 && <span className={styles.wxDetail}>{row[3]}%</span>}
      {t.aqi && (
        <span className={`${styles.aqi} ${styles[`aqi-${aqiTone(t.aqi.aqi)}`]}`}>
          AQI {t.aqi.aqi} {t.aqi.category}
        </span>
      )}
    </span>
  );
}

export function TerminalWeather({
  dep,
  arr,
  atMs,
  nowMs,
}: {
  dep: number;
  arr: number;
  /** The sailing being viewed; the chips describe THIS hour. */
  atMs: number | null;
  /** The page's clock (useNow upstream) - render-pure staleness math. */
  nowMs: number;
}) {
  const [doc, setDoc] = useState<WeatherDoc | null>(null);
  // Portal targets are in the server-rendered shell; resolve them after
  // mount so hydration never races the document.
  const [slots, setSlots] = useState<{ dep: Element | null; arr: Element | null }>({
    dep: null,
    arr: null,
  });

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      if (!alive) return;
      setSlots({
        dep: document.getElementById(DEP_SLOT_ID),
        arr: document.getElementById(ARR_SLOT_ID),
      });
      void getWeather().then((d) => alive && setDoc(d));
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, []);

  if (!doc || atMs === null) return null;

  const ends = [
    { wx: doc.terminals[String(dep)], slot: slots.dep },
    { wx: doc.terminals[String(arr)], slot: slots.arr },
  ]
    .map((e) => ({ ...e, row: e.wx ? hourFor(e.wx, atMs) : null }))
    .filter((e): e is { wx: TerminalWx; slot: Element | null; row: HourRow } => !!e.row);
  if (ends.length === 0) return null;

  const stalest = Math.min(...ends.filter((e) => e.wx.as_of).map((e) => Date.parse(e.wx.as_of!)));

  return (
    <>
      {ends.map((e) => e.slot && createPortal(<Chip t={e.wx} row={e.row} />, e.slot, e.wx.name))}
      {Number.isFinite(stalest) && nowMs - stalest > STALE_FORECAST_MS && (
        <p className={styles.stale} data-testid="weather-stale">
          forecast from{" "}
          {new Date(stalest).toLocaleString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
          })}
        </p>
      )}
    </>
  );
}
