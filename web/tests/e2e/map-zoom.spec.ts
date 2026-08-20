import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Vessel markers under zoom (docs/features/realtime-map.md): boats grow
// as the rider zooms in (continuous --vm-scale ramp - they used to be
// fixed-px, so zooming in made them read SMALLER against the growing
// scenery), and the marker's anchored box is the boat alone, so the
// lat/lon stays pinned to the hull's center - not to the center of a
// box inflated by the name/ETA labels, which used to push the boat
// ~14px off its true position whenever labels were visible.

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

const json = (body: unknown) => ({
  body: JSON.stringify(body),
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
});

// Aspect-correct (55x11) transparent PNG standing in for the mirrored
// WSDOT drawings, which are gitignored and absent on CI runners - the
// boat imgs must load from a fulfilled route, never from disk.
const DRAWING_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADcAAAALCAYAAADbYxWQAAAAKUlEQVR4nGMISCi4MFwxw0A7YNRzo54b9dzwwaOeG6p41HNDFQ9rzwEAENKUbWBCUTcAAAAASUVORK5CYII=",
  "base64",
);

async function openMap(page: Page) {
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill(json(fleet)));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );
  await page.route("**/assets/vessels/*-t.png", (r) =>
    r.fulfill({ body: DRAWING_PNG, contentType: "image/png" }),
  );
  await page.goto("/");
  await page.waitForSelector("[data-vessel] .boat img");
}

// Trusted wheel input over open water - synthetic WheelEvents are ignored
// by MapLibre's scroll-zoom, which is exactly why this lives in e2e.
async function wheelZoom(page: Page, notches: number) {
  await page.mouse.move(400, 300);
  const step = notches > 0 ? -240 : 240;
  for (let i = 0; i < Math.abs(notches); i++) await page.mouse.wheel(0, step);
  await page.waitForTimeout(700); // let the zoom easing settle
}

test("boats grow on zoom-in and shrink back on zoom-out", async ({ page }) => {
  await openMap(page);
  const boat = page.locator("[data-vessel] .boat img").first();
  const overview = (await boat.boundingBox())!;

  await wheelZoom(page, 10);
  const zoomedIn = (await boat.boundingBox())!;
  expect(zoomedIn.width).toBeGreaterThan(overview.width * 1.15);

  await wheelZoom(page, -10);
  const backOut = (await boat.boundingBox())!;
  expect(backOut.width).toBeLessThan(zoomedIn.width);
});

test("a missing drawing falls back to the traced icon, never an empty marker", async ({ page }) => {
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill(json(fleet)));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );
  await page.route("**/assets/vessels/*-t.png", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.locator("[data-vessel] .boat svg").first()).toBeVisible({ timeout: 15_000 });
});

test("the anchored point stays on the boat even with labels visible", async ({ page }) => {
  await openMap(page);
  await wheelZoom(page, 10); // past the declutter zoom so labels render

  const m = await page.evaluate(() => {
    // A marker whose labels are actually shown (moored-cluster companions
    // hide theirs) - that is the case that used to inflate the box.
    for (const el of document.querySelectorAll<HTMLElement>("[data-vessel]")) {
      const nm = el.querySelector<HTMLElement>(".nm");
      const boatEl = el.querySelector<HTMLElement>(".boat img, .boat svg");
      if (!nm || !boatEl || getComputedStyle(nm).display === "none") continue;
      const box = el.getBoundingClientRect(); // MapLibre pins its center to the lat/lon
      const boat = boatEl.getBoundingClientRect(); // where the hull is actually drawn
      return {
        found: true,
        offX: Math.abs(box.left + box.width / 2 - (boat.left + boat.width / 2)),
        offY: Math.abs(box.top + box.height / 2 - (boat.top + boat.height / 2)),
      };
    }
    return { found: false, offX: -1, offY: -1 };
  });

  expect(m.found).toBe(true);
  // Sub-2px: the anchored box IS the boat. In-flow labels used to put
  // this at ~14px vertical.
  expect(m.offY).toBeLessThan(2);
  expect(m.offX).toBeLessThan(2);
});
