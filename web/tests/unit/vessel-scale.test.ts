import { describe, expect, it } from "vitest";
import {
  VESSEL_SCALE_BASE_ZOOM,
  VESSEL_SCALE_MAX,
  VESSEL_SCALE_MIN,
  vesselScaleForZoom,
} from "@/lib/map/vessels/anchor";

describe("vessel zoom scale", () => {
  it("keeps the tuned overview size at the base zoom", () => {
    expect(vesselScaleForZoom(VESSEL_SCALE_BASE_ZOOM)).toBe(1);
  });

  it("grows as the rider zooms in, shrinks as they zoom out", () => {
    // The whole point of the rework: zooming IN must never make the
    // boats read smaller against the growing scenery.
    expect(vesselScaleForZoom(11)).toBeGreaterThan(vesselScaleForZoom(10));
    expect(vesselScaleForZoom(9)).toBeLessThan(1);
  });

  it("clamps both ends so extremes stay tasteful", () => {
    expect(vesselScaleForZoom(16)).toBe(VESSEL_SCALE_MAX);
    expect(vesselScaleForZoom(4)).toBe(VESSEL_SCALE_MIN);
  });

  it("is continuous through the declutter threshold - no step", () => {
    const below = vesselScaleForZoom(10.19);
    const above = vesselScaleForZoom(10.21);
    expect(Math.abs(above - below)).toBeLessThan(0.02);
  });
});
