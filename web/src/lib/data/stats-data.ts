// Stats + capacity fetchers. Live mode reads the materialized contracts
// through CloudFront (ADR-0005); fixture mode serves checked-in samples so
// dev and Playwright exercise every honesty branch - degraded slots,
// non-reporting terminals, stale capacity - without waiting for the Sound
// to produce them.

import { CAPACITY_PATH, DATA_BASE, DATA_MODE, pairStatsPath, STATS_SUMMARY_PATH } from "@/config";
import { slotKeyFor } from "@/lib/stats/reliability";
import { fixtureBaseMs } from "@/lib/trip/fixture-template";
import {
  isCapacityDoc,
  isPairStats,
  isStatsSummary,
  type CapacityDoc,
  type PairStats,
  type StatsSummary,
} from "@/lib/stats/types";

// The departure offsets baked into pair-day.template.json, in minutes
// from load time. Keeping the two fixtures on one clock is what lets
// the reliability section line up with the departure list in dev.
const TEMPLATE_OFFSETS_MIN = [6, 18, 55, 130, 210, -8, -40, -95];

export interface StatsFetchers {
  summary(): Promise<StatsSummary | null>;
  pair(dep: number, arr: number): Promise<PairStats | null>;
  capacity(): Promise<CapacityDoc | null>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function guarded<T>(value: unknown, guard: (v: unknown) => v is T): T | null {
  return guard(value) ? value : null;
}

const live: StatsFetchers = {
  summary: async () => guarded(await getJson(DATA_BASE + STATS_SUMMARY_PATH), isStatsSummary),
  pair: async (dep, arr) => guarded(await getJson(DATA_BASE + pairStatsPath(dep, arr)), isPairStats),
  capacity: async () => guarded(await getJson(DATA_BASE + CAPACITY_PATH), isCapacityDoc),
};

// Fixture capacity is re-timed around "now" so the gauge always has
// upcoming sailings to show, the same trick the pair-day template uses.
const fixture: StatsFetchers = {
  summary: async () => guarded(await getJson("/dev-fixtures/stats-summary.json"), isStatsSummary),
  pair: async (dep, arr) => {
    const doc = guarded(await getJson("/dev-fixtures/stats-pair.json"), isPairStats);
    if (!doc) return null;
    // Re-key the slots onto the pair-day template's own departure offsets,
    // so "your sailing" resolves in dev and in Playwright exactly as it
    // does in production, where a real slot and a real departure share a
    // clock time. A healthy slot lands on the next boat and a degraded one
    // right behind it, keeping both honesty branches on screen.
    // Interleave healthy and degraded slots rather than grouping them, so
    // the collapsed six-row view always contains at least one "hour" row.
    // A third of real slots degrade; a fixture that hides them would let a
    // regression in that copy ship unnoticed.
    const healthy = doc.slots.filter((s) => s.basis !== "hour");
    const degraded = doc.slots.filter((s) => s.basis === "hour");
    const ordered = [];
    while (healthy.length > 0 || degraded.length > 0) {
      const clean = healthy.shift();
      if (clean) ordered.push(clean);
      const thin = degraded.shift();
      if (thin) ordered.push(thin);
    }
    const slots = ordered
      .map((slot, i) => {
        const offset = TEMPLATE_OFFSETS_MIN[i];
        return offset === undefined ? null : { ...slot, hhmm: slotKeyFor(fixtureBaseMs() + offset * 60_000) };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    return { ...doc, pair: { ...doc.pair, dep, arr }, slots };
  },
  capacity: async () => {
    const doc = guarded(await getJson("/dev-fixtures/capacity.json"), isCapacityDoc);
    if (!doc) return null;
    // Readings land ON the template's own upcoming departures, off the one
    // fixture clock: the page joins them by depart_ms, so an independent
    // Date.now() or an offset the schedule does not have renders no chips at
    // all - the exact state the honesty note is meant to be rare.
    const base = fixtureBaseMs();
    const upcoming = TEMPLATE_OFFSETS_MIN.filter((m) => m > 0).sort((a, b) => a - b);
    const pairs = Object.fromEntries(
      Object.entries(doc.pairs).map(([key, sailings]) => [
        key,
        sailings
          .slice(0, upcoming.length)
          .map((s, i) => ({ ...s, depart_ms: base + upcoming[i]! * 60_000 })),
      ]),
    );
    return { ...doc, generated_at: new Date().toISOString(), pairs };
  },
};

export function makeStatsFetchers(): StatsFetchers {
  const inner = process.env.NODE_ENV === "development" && DATA_MODE === "fixture" ? fixture : live;
  // Uniform error policy, same as the trip fetchers: a missing or
  // malformed document becomes null and the section simply does not render.
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
    summary: safely(inner.summary),
    pair: safely(inner.pair),
    capacity: safely(inner.capacity),
  };
}
