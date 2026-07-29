import { describe, expect, it } from "vitest";
import { planMooredLabels } from "@/lib/map/vessels/cluster";
import type { VesselFix } from "@/lib/data/types";

function fix(partial: Partial<VesselFix> & { id: number; lat: number; lon: number }): VesselFix {
  return {
    name: `V${partial.id}`,
    speed: 0,
    heading: 0,
    state: "docked",
    insvc: true,
    age_s: 10,
    dep: 3,
    arr: null,
    left: null,
    eta: null,
    eta_basis: null,
    sched: null,
    routes: [],
    pos: null,
    ...partial,
  };
}

// Eagle Harbor yard coordinates; ~0.002 deg lat ~= 220 m.
const EH = { lat: 47.6205, lon: -122.5145 };

describe("moored label clustering", () => {
  it("groups the yard trio: one keeps a +2 label, two go sprite-only", () => {
    const plan = planMooredLabels([
      fix({ id: 30, ...EH, state: "yard" }),
      fix({ id: 17, lat: EH.lat + 0.001, lon: EH.lon, state: "stale", age_s: 999 }),
      fix({ id: 25, lat: EH.lat, lon: EH.lon + 0.002, state: "stale", age_s: 999 }),
    ]);
    expect(plan.companions.get(17)).toBe(2); // lowest id is primary
    expect([...plan.hidden].sort()).toEqual([25, 30]);
  });

  it("never suppresses underway vessels, even inside a cluster", () => {
    const plan = planMooredLabels([
      fix({ id: 1, ...EH }),
      fix({ id: 2, lat: EH.lat + 0.0005, lon: EH.lon, state: "underway", speed: 14 }),
    ]);
    expect(plan.hidden.size).toBe(0);
    expect(plan.companions.size).toBe(0);
  });

  it("leaves lone moored boats untouched", () => {
    const plan = planMooredLabels([
      fix({ id: 1, ...EH }),
      fix({ id: 2, lat: 47.81, lon: -122.38 }), // Edmonds - far away
    ]);
    expect(plan.hidden.size).toBe(0);
  });

  it("treats over-age vessels as moored regardless of upstream state", () => {
    const plan = planMooredLabels([
      fix({ id: 1, ...EH, state: "underway", age_s: 9999 }), // stale by age
      fix({ id: 2, lat: EH.lat + 0.001, lon: EH.lon }),
    ]);
    expect(plan.companions.get(1)).toBe(1);
    expect(plan.hidden.has(2)).toBe(true);
  });
});
