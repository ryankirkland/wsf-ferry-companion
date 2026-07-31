// M4 contracts: /data/stats/summary.json, /data/stats/pairs/{dep}-{arr}.json,
// /data/capacity.json. Same discipline as the trip documents - a payload that
// fails its guard is dropped, and the caller keeps its last good copy or
// renders nothing. A reliability section that renders half a document is
// worse than one that admits it has no numbers.

/** Every published statistic carries its own sample size. */
export interface StatBlock {
  n: number;
  ontime_pct: number | null;
  p50: number | null;
  p90: number | null;
}

export interface StatWindow {
  label: string;
  from: string;
  to: string;
}

/** "slot": this exact departure time. "hour": too few sailings, so the
 *  numbers shown are the whole hour's, and the UI must say so. */
export type SlotBasis = "slot" | "hour";

export interface SlotStat {
  hhmm: string;
  basis: SlotBasis;
  primary: StatBlock;
  /** This slot's own window numbers, however thin - kept even when
   *  degraded so the page can quantify how little evidence there is. */
  slot_window: StatBlock;
  all_time: StatBlock;
}

export interface SeasonStat {
  season: string;
  n: number;
  ontime_pct: number | null;
  p90: number | null;
}

export interface Cancellations {
  tracking_since: string;
  window: { from: string; to: string } | null;
  note: string;
  scheduled: number;
  not_sailed: number;
  days?: number;
  pair_days?: number;
  unreconciled_days: number;
  rate_pct: number | null;
}

export interface PairStats {
  v: number;
  generated_at: string;
  data_through: string;
  window: StatWindow;
  pair: { dep: number; arr: number; dep_name: string; arr_name: string; slug: string };
  ontime_definition_min: number;
  min_slot_sample: number;
  overall: { primary: StatBlock; all_time: StatBlock };
  slots: SlotStat[];
  seasons: SeasonStat[];
  cancellations: Cancellations;
}

export interface VesselStat {
  vessel_name: string;
  primary: StatBlock;
  all_time: StatBlock;
}

export interface StatsSummary {
  v: number;
  generated_at: string;
  data_through: string;
  window: StatWindow;
  ontime_definition_min: number;
  coverage: {
    since: string;
    through: string;
    sailings: number;
    vessels: number;
    pairs_published: number;
    note: string;
    thin_days: { service_date: string; n: number; vessels: number }[];
    thin_days_note: string;
  };
  system: { primary: StatBlock; all_time: StatBlock };
  by_year: { year: number; n: number; ontime_pct: number | null; p90: number | null }[];
  by_month: { month: number; n: number; ontime_pct: number | null; p90: number | null }[];
  superlatives: {
    most_punctual_vessel: { vessel_name: string; ontime_pct: number; n: number } | null;
    roughest_month: { month: number; ontime_pct: number; n: number } | null;
    most_punctual_pair: PairSuperlative | null;
    toughest_pair: PairSuperlative | null;
  };
  vessels: VesselStat[];
  cancellations: Cancellations;
}

export interface PairSuperlative {
  dep: number;
  arr: number;
  name: string;
  slug: string | null;
  ontime_pct: number | null;
  n: number;
}

export type DriveUpLevel = "plenty" | "filling" | "full";

export interface CapacitySailing {
  depart_ms: number;
  vessel: string | null;
  cancelled: boolean;
  drive_up: number | null;
  /** WSF's own fullness judgment; null when they published a code we
   *  have not seen, never a level we inferred ourselves. */
  level: DriveUpLevel | null;
  max_space: number | null;
  reservable: number | null;
}

export interface CapacityDoc {
  v: number;
  generated_at: string;
  /** Terminals that publish drive-up space at all. A terminal missing
   *  here has no data, which is different from having no room. */
  reporting_terminals: number[];
  pairs: Record<string, CapacitySailing[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatBlock(value: unknown): value is StatBlock {
  return isRecord(value) && typeof value.n === "number";
}

function isWindow(value: unknown): value is StatWindow {
  return isRecord(value) && typeof value.from === "string" && typeof value.to === "string";
}

export function isPairStats(value: unknown): value is PairStats {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.data_through !== "string" || !isWindow(value.window)) return false;
  if (!isRecord(value.pair) || typeof value.pair.slug !== "string") return false;
  if (!isRecord(value.overall) || !isStatBlock(value.overall.primary)) return false;
  if (!Array.isArray(value.slots)) return false;
  return value.slots.every(
    (s: unknown) =>
      isRecord(s) &&
      typeof s.hhmm === "string" &&
      (s.basis === "slot" || s.basis === "hour") &&
      isStatBlock(s.primary) &&
      isStatBlock(s.slot_window),
  );
}

export function isStatsSummary(value: unknown): value is StatsSummary {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.data_through !== "string" || !isWindow(value.window)) return false;
  if (!isRecord(value.coverage) || typeof value.coverage.sailings !== "number") return false;
  if (!isRecord(value.system) || !isStatBlock(value.system.primary)) return false;
  return Array.isArray(value.by_year) && Array.isArray(value.vessels);
}

export function isCapacityDoc(value: unknown): value is CapacityDoc {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.generated_at !== "string") return false;
  if (!Array.isArray(value.reporting_terminals)) return false;
  if (!isRecord(value.pairs)) return false;
  return Object.values(value.pairs).every(
    (sailings) =>
      Array.isArray(sailings) &&
      sailings.every((s: unknown) => isRecord(s) && typeof s.depart_ms === "number"),
  );
}
