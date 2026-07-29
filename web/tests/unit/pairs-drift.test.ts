// The checked-in slug map must mirror the live pairs index. The fixture is
// regenerated from production by tools/fixtures/build-trip-fixture.mjs; if
// WSF adds or drops a pair, this test fails and the regeneration script is
// the fix - never a hand edit.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAIRS } from "@/lib/trip/pairs";
import { isPairsIndex, type PairsIndex } from "@/lib/trip/types";

const index = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../public/dev-fixtures/pairs-index.json"), "utf8"),
) as PairsIndex;

describe("slug map vs pairs index", () => {
  it("fixture is a valid PairsIndex", () => {
    expect(isPairsIndex(index)).toBe(true);
  });

  it("same pair set, same identities", () => {
    expect(Object.keys(PAIRS)).toHaveLength(index.pairs.length);
    for (const p of index.pairs) {
      const entry = PAIRS[p.slug];
      expect(entry, `missing slug ${p.slug}`).toBeDefined();
      expect(entry).toMatchObject({ dep: p.dep, arr: p.arr, depName: p.dep_name, arrName: p.arr_name });
    }
  });

  it("mates are symmetric reverses", () => {
    for (const [slug, entry] of Object.entries(PAIRS)) {
      expect(entry.mate, `no mate for ${slug}`).not.toBeNull();
      const mate = PAIRS[entry.mate!]!;
      expect(mate.dep).toBe(entry.arr);
      expect(mate.arr).toBe(entry.dep);
      expect(mate.mate).toBe(slug);
    }
  });

  it("slugs are url-safe", () => {
    for (const slug of Object.keys(PAIRS)) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
