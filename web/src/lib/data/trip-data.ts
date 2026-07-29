// Trip document fetchers - live mode reads /data/* (ADR-0005 snapshots via
// CloudFront), fixture mode serves /dev-fixtures with the re-timed template
// so every signal band is visible in dev. All responses pass the runtime
// guards or are dropped (callers keep their last good copy).

import {
  ALERTS_PATH,
  DATA_BASE,
  DATA_MODE,
  PAIRS_INDEX_PATH,
  pairDayPath,
  pairFaresPath,
} from "@/config";
import { resolveTripTemplate } from "@/lib/trip/fixture-template";
import {
  isAlertsDoc,
  isPairDay,
  isPairFares,
  isPairsIndex,
  type AlertsDoc,
  type PairDay,
  type PairFares,
  type PairsIndex,
} from "@/lib/trip/types";

export interface TripFetchers {
  index(): Promise<PairsIndex | null>;
  day(dep: number, arr: number, date: string): Promise<PairDay | null>;
  fares(dep: number, arr: number): Promise<PairFares | null>;
  alerts(): Promise<AlertsDoc | null>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

function guarded<T>(value: unknown, guard: (v: unknown) => v is T): T | null {
  return guard(value) ? value : null;
}

const live: TripFetchers = {
  index: async () => guarded(await getJson(DATA_BASE + PAIRS_INDEX_PATH), isPairsIndex),
  day: async (dep, arr, date) =>
    guarded(await getJson(DATA_BASE + pairDayPath(dep, arr, date)), isPairDay),
  fares: async (dep, arr) => guarded(await getJson(DATA_BASE + pairFaresPath(dep, arr)), isPairFares),
  alerts: async () => guarded(await getJson(DATA_BASE + ALERTS_PATH), isAlertsDoc),
};

// Fixture mode: one template pair-day re-timed around "now" and re-labeled
// for whatever pair/date is requested; fares/alerts likewise re-labeled.
const fixture: TripFetchers = {
  index: async () => guarded(await getJson("/dev-fixtures/pairs-index.json"), isPairsIndex),
  day: async (dep, arr, date) => {
    const raw = await getText("/dev-fixtures/pair-day.template.json");
    const doc = guarded(JSON.parse(resolveTripTemplate(raw, Date.now())), isPairDay);
    if (!doc) return null;
    return { ...doc, pair: { dep, arr }, service_date: date };
  },
  fares: async (dep, arr) => {
    const doc = guarded(await getJson("/dev-fixtures/fares-14-5.json"), isPairFares);
    return doc ? { ...doc, pair: { dep, arr } } : null;
  },
  alerts: async () => {
    const raw = await getText("/dev-fixtures/alerts.json");
    return guarded(JSON.parse(resolveTripTemplate(raw, Date.now())), isAlertsDoc);
  },
};

export function makeTripFetchers(): TripFetchers {
  const inner = DATA_MODE === "fixture" ? fixture : live;
  // Uniform error policy: network/parse failures become nulls here so hooks
  // and components never juggle exceptions.
  const safely =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R | null>) =>
    async (...args: A): Promise<R | null> => {
      try {
        return await fn(...args);
      } catch {
        return null;
      }
    };
  return {
    index: safely(inner.index),
    day: safely(inner.day),
    fares: safely(inner.fares),
    alerts: safely(inner.alerts),
  };
}
