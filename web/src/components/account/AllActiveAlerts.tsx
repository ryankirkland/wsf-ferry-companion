"use client";

// Everything WSF is saying right now, across every route (owner's walk,
// 2026-08-19). Public data - no sign-in needed. Route names resolve from
// the pairs index; a bulletin whose text merely repeats its title shows
// the title once, not twice (WSF does this constantly - the rule lives
// in alertBody, shared with the trip page's banner).

import { useEffect, useMemo, useState } from "react";
import { makeTripFetchers } from "@/lib/data/trip-data";
import { soundStamp } from "@/lib/time/sound-time";
import { alertBody } from "@/lib/trip/alert-text";
import type { AlertsDoc, PairsIndex } from "@/lib/trip/types";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./account.module.css";

export function AllActiveAlerts() {
  const fetchers = useMemo(() => makeTripFetchers(), []);
  const [alerts, setAlerts] = useState<AlertsDoc | null>(null);
  const [index, setIndex] = useState<PairsIndex | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      void fetchers.alerts().then((doc) => {
        if (!alive) return;
        if (doc) setAlerts(doc);
        setSettled(true);
      });
      void fetchers.index().then((doc) => alive && doc && setIndex(doc));
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [fetchers]);

  // route_id -> "Seattle ↔ Bainbridge Island" from the first pair on it.
  const routeNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const p of index?.pairs ?? []) {
      if (p.route_id != null && !names.has(p.route_id)) {
        names.set(p.route_id, `${p.dep_name} ↔ ${p.arr_name}`);
      }
    }
    return names;
  }, [index]);

  if (!settled) return <p className={tripStyles.rangeNote}>Checking the wire…</p>;

  const items = alerts?.alerts ?? [];
  if (items.length === 0) {
    return (
      <p className={tripStyles.rangeNote} data-testid="all-alerts-empty">
        No active bulletins right now - a quiet Sound.
      </p>
    );
  }

  return (
    <div className={styles.allAlerts} data-testid="all-alerts">
      {items.map((a) => {
        const body = alertBody(a);
        return (
          <article key={a.id} className={styles.alertCard}>
            <h3>
              {a.title}
              {a.published && (
                <time dateTime={a.published}>{soundStamp(a.published)}</time>
              )}
            </h3>
            {body && <p>{body}</p>}
            <p className={styles.alertRoutes}>
              {a.all_routes || a.route_ids.length === 0
                ? "All routes"
                : a.route_ids.map((id) => routeNames.get(id) ?? `route ${id}`).join(" · ")}
            </p>
          </article>
        );
      })}
    </div>
  );
}
