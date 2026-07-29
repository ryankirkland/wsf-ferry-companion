// Map-facing palette constants (MapLibre paint props need literal strings,
// not CSS vars). Mirrors tokens.css / direction.md - a vitest drift check
// (tests/unit/palette-drift.test.ts) keeps them honest.

import type { Mode } from "@/lib/time/sound-time";

export interface MapPalette {
  land: string;
  green: string;
  water: string;
  waterway: string;
  road: string;
  roadMajor: string;
  boundary: string;
  text: string;
  halo: string;
  waterText: string;
  hillShadow: string;
  hillLight: string;
  hillAmt: number;
  grain: "grain-dark" | "grain-light";
}

export const PAL: Record<Mode, MapPalette> = {
  day: {
    land: "#efe9db",
    green: "#c9d5b5",
    water: "#74a8b0",
    waterway: "#8db8be",
    road: "#ddd5c2",
    roadMajor: "#d3c9b2",
    boundary: "#b9b0a0",
    text: "#26333a",
    halo: "#f2efe9",
    waterText: "#33606a",
    hillShadow: "#a3947a",
    hillLight: "#fdf9ee",
    hillAmt: 0.28,
    grain: "grain-dark",
  },
  dusk: {
    land: "#e8d7bd",
    green: "#bcc4a0",
    water: "#587b92",
    waterway: "#6f8ea2",
    road: "#d4c3a5",
    roadMajor: "#c8b696",
    boundary: "#a89a80",
    text: "#3a3a30",
    halo: "#eee0c6",
    waterText: "#3e5a6e",
    hillShadow: "#87735c",
    hillLight: "#f8e8ca",
    hillAmt: 0.3,
    grain: "grain-dark",
  },
  night: {
    land: "#131f26",
    green: "#17281f",
    water: "#1f3a46",
    waterway: "#27444f",
    road: "#20303a",
    roadMajor: "#273a45",
    boundary: "#2b3d47",
    text: "#dbe6e2",
    halo: "#131f26",
    waterText: "#6f98a2",
    hillShadow: "#070e13",
    hillLight: "#1e3944",
    hillAmt: 0.35,
    grain: "grain-light",
  },
};
