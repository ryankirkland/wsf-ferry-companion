// The fleet snapshot contract (ADR-0005, "v": 1) - produced by
// services/ingest/snapshot.py, consumed here. Breaking changes require a
// new version, never a mutation.

export type VesselState = "underway" | "docked" | "yard" | "stale";

export interface VesselFix {
  id: number;
  name: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  state: VesselState;
  insvc: boolean;
  age_s: number;
  dep: number;
  arr: number | null;
  left: string | null;
  eta: string | null;
  eta_basis: string | null;
  sched: string | null;
  routes: string[];
  pos: number | null;
}

export interface FleetSnapshot {
  v: 1;
  generated_at: string;
  vessels: VesselFix[];
}

const STATES = new Set(["underway", "docked", "yard", "stale"]);

/** Hand-written runtime guard - malformed snapshots are dropped, last good
 * retained. No schema library for one shape. */
export function isFleetSnapshot(value: unknown): value is FleetSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.v !== 1 || typeof s.generated_at !== "string" || !Array.isArray(s.vessels)) return false;
  return s.vessels.every((v: unknown) => {
    if (typeof v !== "object" || v === null) return false;
    const f = v as Record<string, unknown>;
    return (
      typeof f.id === "number" &&
      typeof f.name === "string" &&
      typeof f.lat === "number" &&
      typeof f.lon === "number" &&
      typeof f.speed === "number" &&
      typeof f.heading === "number" &&
      typeof f.state === "string" &&
      STATES.has(f.state) &&
      typeof f.age_s === "number"
    );
  });
}

export type FeedState = "live" | "stale" | "down";
