import { describe, expect, it } from "vitest";
import { LABEL_HINTS, servedTerminals } from "@/lib/map/terminals";
import { VESSEL_ANCHOR_PX } from "@/lib/map/vessels/anchor";
import { REFERENCE_FEET } from "@/lib/map/vessels/class-icons";
import type { TerminalDim } from "@/lib/data/dims";

const term = (id: number, name: string): TerminalDim => ({
  id,
  name,
  abbrev: name.slice(0, 3).toUpperCase(),
  lat: 47.6,
  lon: -122.4,
  synthetic: false,
});

const DIM = [
  term(7, "Seattle"),
  term(3, "Bainbridge Island"),
  term(19, "Sidney B.C."), // route ended 2019
  { ...term(122, "Eagle Harbor"), synthetic: true },
];

describe("which terminals the map draws", () => {
  it("drops a terminal the schedule no longer sails to", () => {
    const served = servedTerminals(DIM, new Set([7, 3]));
    expect(served.map((t) => t.name)).not.toContain("Sidney B.C.");
    expect(served.map((t) => t.name)).toContain("Seattle");
  });

  it("keeps the yard, which no schedule ever lists", () => {
    expect(servedTerminals(DIM, new Set([7, 3])).map((t) => t.id)).toContain(122);
  });

  it("draws everything when the pairs index is unavailable", () => {
    // An empty served-set means "no opinion", not "nothing is served" - the
    // first version of this filter would have left a map of only the yard.
    expect(servedTerminals(DIM, new Set())).toHaveLength(DIM.length);
  });
});

describe("terminal label hints", () => {
  it("covers every terminal the live network uses", () => {
    // The map labelled 5 of 20 terminals for a whole milestone because this
    // table was a hardcoded central-Sound list. Clinton and Mukilteo sat
    // unlabelled in the default view with a ferry docked at Clinton.
    for (const id of [1, 5, 9, 10, 13, 14, 15, 16, 17, 18, 20, 21, 22]) {
      expect(LABEL_HINTS[id], `terminal ${id} has no label hint`).toBeDefined();
    }
  });

  it("names every rider port at every zoom; only the yard defers", () => {
    // Owner's 2026-08-20 walks, both rounds: first the Fauntleroy
    // triangle, then the whole northern network vanished at far zoom.
    // `minor` is now exclusively the yard's tier - a rider port with
    // minor:true is a regression to invisible-until-zoomed.
    for (const [id, hint] of Object.entries(LABEL_HINTS)) {
      if (id === "122") continue;
      expect(hint.minor, `rider port ${id} demoted to minor`).toBeFalsy();
    }
    expect(LABEL_HINTS[122]?.minor).toBe(true);
  });

  it("dense clusters defer chips, never names", () => {
    // Three staggered NAMES fit in the San Juans' 25px blob at the zoom
    // floor; three 75px chips cannot. chip-late is safe only for ports
    // outside the default phone framing - the triangle (9/20/22) must
    // NEVER get it, that exact compromise already failed the owner once.
    for (const id of [1, 10, 11, 13, 15, 16, 17, 18, 21]) {
      expect(LABEL_HINTS[id]?.chipLate, `terminal ${id} lost chip-late`).toBe(true);
    }
    for (const id of [9, 20, 22]) {
      expect(LABEL_HINTS[id]?.chipLate, `triangle terminal ${id} hides its chip`).toBeFalsy();
    }
  });

  it("keeps the Fauntleroy triangle named at full zoom-out, staggered", () => {
    // The triangle shares one screen row at the zoom floor; demoting it to
    // minor made three commuter terminals vanish (owner's 2026-08-20 walk).
    // Staggering is what makes naming them possible - one without the
    // other regresses to either invisibility or a label pile-up.
    for (const id of [9, 20, 22]) {
      expect(LABEL_HINTS[id]?.minor, `terminal ${id} demoted`).toBeFalsy();
      expect(LABEL_HINTS[id]?.stagger, `terminal ${id} unstaggered`).toBeDefined();
    }
    // Southworth and Vashon hang BELOW their dots: above-stacks put
    // Southworth's chip row on Bremerton's name row from the zoom floor
    // to ~z10, which forced the chips to hide - and phones frame the map
    // just under the declutter zoom, so the triangle lost its weather.
    expect(LABEL_HINTS[20]?.below, "Southworth stacks above again").toBe(true);
    expect(LABEL_HINTS[22]?.below, "Vashon stacks above again").toBe(true);
  });
});

describe("vessel scale", () => {
  it("draws the longest ferry big enough to read on a phone", () => {
    // 44px put a Jumbo Mark II at 44x13 and the traced profile was a smudge.
    expect(VESSEL_ANCHOR_PX).toBeGreaterThanOrEqual(60);
  });

  it("keeps real relative lengths rather than a flat icon size", () => {
    const width = (feet: number) => (VESSEL_ANCHOR_PX * feet) / REFERENCE_FEET;
    expect(width(460)).toBeCloseTo(VESSEL_ANCHOR_PX, 5);
    expect(width(274)).toBeLessThan(width(460));
    // …and the smallest class still clears the size the old anchor gave the
    // largest one.
    expect(width(274)).toBeGreaterThan(38);
  });
});
