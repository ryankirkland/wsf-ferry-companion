import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, terminalHidden, vesselHidden } from "@/lib/map/routes";

describe("route taxonomy", () => {
  it("covers every route abbrev the fleet fixture uses", () => {
    // The taxonomy is curated, so a NEW WSF route must fail here rather
    // than sail unfiltered (and unfilterable) forever.
    const fleet = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "public/dev-fixtures/fleet-frame-0.json"), "utf8"),
    ) as { vessels: { routes: string[] }[] };
    const known = new Set(ROUTES.map((r) => r.abbrev));
    for (const v of fleet.vessels) {
      for (const r of v.routes) {
        expect(known.has(r), `route abbrev ${r} missing from ROUTES`).toBe(true);
      }
    }
  });

  it("labels are unique and terminals non-empty", () => {
    const labels = new Set(ROUTES.map((r) => r.label));
    expect(labels.size).toBe(ROUTES.length);
    for (const r of ROUTES) expect(r.terminals.length).toBeGreaterThan(0);
  });
});

describe("vesselHidden", () => {
  const hidden = new Set(["ana-sj", "pt-cou"]);

  it("hides a boat only when every route it sails is hidden", () => {
    expect(vesselHidden(["ana-sj"], hidden)).toBe(true);
    expect(vesselHidden(["ana-sj", "sea-br"], hidden)).toBe(false);
  });

  it("never hides a boat it cannot classify", () => {
    // Yard moves and repositioning report no routes; filtering trims
    // noise, it must not make real boats vanish unaccountably.
    expect(vesselHidden([], hidden)).toBe(false);
  });

  it("empty filter hides nothing", () => {
    expect(vesselHidden(["ana-sj"], new Set())).toBe(false);
  });
});

describe("terminalHidden", () => {
  it("hides a terminal only when every serving route is hidden", () => {
    // Seattle serves sea-bi and sea-br: hiding one keeps the terminal.
    expect(terminalHidden(7, new Set(["sea-bi"]))).toBe(false);
    expect(terminalHidden(7, new Set(["sea-bi", "sea-br"]))).toBe(true);
    // Bremerton is sea-br only.
    expect(terminalHidden(4, new Set(["sea-br"]))).toBe(true);
  });

  it("never hides a terminal outside the taxonomy (the yard)", () => {
    const all = new Set(ROUTES.map((r) => r.abbrev));
    expect(terminalHidden(122, all)).toBe(false);
  });
});
