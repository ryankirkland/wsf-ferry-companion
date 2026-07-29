// The four M2 data contracts (ADR-0005 extension, all "v": 1) - produced
// by services/ingest (pairs_builder, schedule_refresh, alerts), consumed
// here. Breaking changes require a new version, never a mutation.
// Guards are shallow-but-honest like isFleetSnapshot: malformed docs are
// dropped and the last good copy retained.

export interface PairsIndex {
  v: 1;
  generated_at: string;
  schedule_id: number;
  schedule_name: string;
  horizon: { from: string; to: string };
  terminals: { id: number; name: string; slug: string }[];
  pairs: PairInfo[];
}

export interface PairInfo {
  dep: number;
  arr: number;
  dep_name: string;
  arr_name: string;
  slug: string;
  route_id: number | null;
  crossing_min: number | null;
  reservable: boolean;
  passenger_only: boolean;
}

export interface Sailing {
  depart: string;
  depart_ms: number;
  vessel_id: number;
  vessel: string;
  pos_num: number | null;
  accessible: boolean;
  loading_rule: number | null;
  after_midnight: boolean;
  added: boolean;
  notes: string[];
}

export interface Adjustment {
  type: "add" | "cancel";
  time_local: string;
  terminal_id: number;
  tidal: boolean;
  matched: boolean;
}

export interface PairDay {
  v: 1;
  generated_at: string;
  pair: { dep: number; arr: number };
  service_date: string;
  schedule_id: number;
  crossing_min: number | null;
  sailings: Sailing[];
  adjustments: Adjustment[];
}

export interface FareItem {
  id: number;
  label: string;
  category: string;
  direction_independent: boolean;
  amount: string;
  basic: boolean;
}

export interface PairFares {
  v: 1;
  generated_at: string;
  pair: { dep: number; arr: number };
  trip_date: string;
  retrieved_at: string;
  collection: string | null;
  one_way: FareItem[];
  round_trip: FareItem[];
}

export interface AlertItem {
  id: number;
  title: string;
  text: string | null;
  published: string | null;
  route_ids: number[];
  all_routes: boolean;
}

export interface AlertsDoc {
  v: 1;
  generated_at: string;
  watermark: string;
  alerts: AlertItem[];
}

function isDoc(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1;
}

export function isPairsIndex(value: unknown): value is PairsIndex {
  if (!isDoc(value) || !Array.isArray(value.pairs) || !Array.isArray(value.terminals)) return false;
  return value.pairs.every(
    (p: unknown) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as PairInfo).dep === "number" &&
      typeof (p as PairInfo).arr === "number" &&
      typeof (p as PairInfo).slug === "string",
  );
}

export function isPairDay(value: unknown): value is PairDay {
  if (!isDoc(value) || typeof value.service_date !== "string" || !Array.isArray(value.sailings))
    return false;
  return value.sailings.every(
    (s: unknown) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Sailing).depart === "string" &&
      typeof (s as Sailing).depart_ms === "number" &&
      typeof (s as Sailing).vessel_id === "number",
  );
}

export function isPairFares(value: unknown): value is PairFares {
  if (!isDoc(value) || !Array.isArray(value.one_way) || !Array.isArray(value.round_trip))
    return false;
  return value.one_way.every(
    (f: unknown) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as FareItem).amount === "string" &&
      typeof (f as FareItem).label === "string",
  );
}

export function isAlertsDoc(value: unknown): value is AlertsDoc {
  if (!isDoc(value) || typeof value.watermark !== "string" || !Array.isArray(value.alerts))
    return false;
  return value.alerts.every(
    (a: unknown) =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as AlertItem).id === "number" &&
      typeof (a as AlertItem).title === "string" &&
      Array.isArray((a as AlertItem).route_ids),
  );
}
