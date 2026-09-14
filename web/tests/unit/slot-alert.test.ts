import { describe, expect, it } from "vitest";
import { alertForSlot } from "@/lib/trip/slot-alert";
import type { AlertItem } from "@/lib/trip/types";

const alert = (id: number, title: string, text: string | null = null): AlertItem => ({
  id,
  title,
  text,
  published: null,
  route_ids: [3],
  all_routes: false,
});

describe("alertForSlot", () => {
  const slot = { time_local: "14:05", tidal: true };

  it("matches WSF's military, colon, and spoken time forms as whole tokens", () => {
    expect(alertForSlot(slot, [alert(1, "The 1405 BRE>SEA is cancelled")])?.id).toBe(1);
    expect(alertForSlot(slot, [alert(2, "Sea/Brem", "14:05 sailing cancelled")])?.id).toBe(2);
    expect(alertForSlot(slot, [alert(3, "2:05 p.m. departure cancelled")])?.id).toBe(3);
    // "12:05" contains "2:05" but is a different slot.
    expect(alertForSlot({ ...slot, tidal: false }, [alert(4, "12:05 sailing cancelled")])).toBeNull();
    // "11405" is not the 1405.
    expect(alertForSlot({ ...slot, tidal: false }, [alert(5, "Bulletin 11405")])).toBeNull();
  });

  it("prefers the alert naming the time over a generic tidal notice", () => {
    const tidal = alert(6, "Sea/Brem - tidal cancellations this week");
    const named = alert(7, "The 1405 is cancelled due to tides");
    expect(alertForSlot(slot, [tidal, named])?.id).toBe(7);
  });

  it("falls back to a tidal notice for tidal cancels only", () => {
    const tidal = alert(8, "Low tides cancel several sailings", "Check schedule.");
    expect(alertForSlot(slot, [tidal])?.id).toBe(8);
    expect(alertForSlot({ ...slot, tidal: false }, [tidal])).toBeNull();
  });

  it("returns null with nothing to link", () => {
    expect(alertForSlot(slot, [alert(9, "Elevator out of service")])).toBeNull();
    expect(alertForSlot(slot, [])).toBeNull();
  });
});
