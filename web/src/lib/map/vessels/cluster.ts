// Moored boats often share a berth area (the Eagle Harbor yard trio, paired
// slips at Edmonds) and their labels collide into an ink pile. Plan: within
// each ~320 m cluster of non-underway vessels, the lowest-id boat keeps its
// label with a "+N" companion count; the rest render sprite-only (still
// tappable, still individually state-styled). Underway vessels are never
// suppressed - motion deserves a name.

import { STALE_S } from "@/config";
import type { VesselFix } from "@/lib/data/types";

const CLUSTER_M = 320;
const M_PER_DEG_LAT = 111_320;

export interface LabelPlan {
  /** primary vessel id -> number of label-hidden companions */
  companions: Map<number, number>;
  /** vessel ids whose labels are suppressed */
  hidden: Set<number>;
}

function metersApart(a: VesselFix, b: VesselFix): number {
  const dLat = (a.lat - b.lat) * M_PER_DEG_LAT;
  const dLon = (a.lon - b.lon) * M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

export function planMooredLabels(vessels: VesselFix[]): LabelPlan {
  const moored = vessels.filter(
    (v) => (v.age_s > STALE_S ? "stale" : v.state) !== "underway",
  );

  const clusters: VesselFix[][] = [];
  for (const v of moored) {
    const home = clusters.find((c) => c.some((m) => metersApart(m, v) <= CLUSTER_M));
    if (home) home.push(v);
    else clusters.push([v]);
  }

  const plan: LabelPlan = { companions: new Map(), hidden: new Set() };
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    cluster.sort((a, b) => a.id - b.id);
    plan.companions.set(cluster[0]!.id, cluster.length - 1);
    for (const v of cluster.slice(1)) plan.hidden.add(v.id);
  }
  return plan;
}
