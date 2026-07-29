// Drift guard: the map-facing palette constants must match tokens.css
// (both mirror docs/design/direction.md, which ADR-0002 locked).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAL } from "@/lib/map/palettes";

const css = readFileSync(
  path.resolve(import.meta.dirname, "../../src/styles/tokens.css"),
  "utf-8",
);

function cssToken(mode: string, token: string): string {
  const block = css.split(`html[data-mode="${mode}"]`)[1]?.split("}")[0] ?? "";
  const match = block.match(new RegExp(`--${token}:\\s*([^;]+);`));
  if (!match) throw new Error(`token --${token} missing for mode ${mode}`);
  return match[1]!.trim();
}

// PAL key -> tokens.css custom property. `boundary` is map-only (no CSS
// consumer); grain/hillAmt are not colors.
const MAPPING: Record<string, string> = {
  land: "land",
  green: "green",
  water: "water",
  waterway: "waterway",
  road: "road",
  roadMajor: "road-major",
  text: "ink",
  halo: "halo",
  waterText: "water-text",
  hillShadow: "hill-shadow",
  hillLight: "hill-light",
};

describe("palettes.ts stays in sync with tokens.css", () => {
  for (const mode of ["day", "dusk", "night"] as const) {
    it(`${mode} palette matches`, () => {
      for (const [palKey, token] of Object.entries(MAPPING)) {
        expect(
          PAL[mode][palKey as keyof (typeof PAL)[typeof mode]],
          `${mode}.${palKey} vs --${token}`,
        ).toBe(cssToken(mode, token));
      }
    });
  }
});
