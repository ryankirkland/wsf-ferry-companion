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

/** The vessel marker nearest the viewport center, with its current
 *  on-screen coordinates. Underway boats glide between snapshots, so
 *  locator.hover() never sees them "stable" - specs move the raw mouse
 *  to the returned point instead, which needs no stability and lands on
 *  the hull before any glide can carry it away. */
async function vesselNearCenter(page: Page) {
  const v = await page.evaluate(() => {
    const candidates: { id: string; cx: number; cy: number; d: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-vessel]")) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 40 || cy < 130 || cx > innerWidth - 40 || cy > innerHeight - 170) continue;
      candidates.push({
        id: el.dataset.vessel ?? "",
        cx,
        cy,
        d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2),
      });
    }
    candidates.sort((a, b) => a.d - b.d);
    // Moored-cluster companions sit UNDER another hull - the top boat
    // owns the pointer (for real users too), so only a marker that
    // actually receives its own center point can be hovered.
    for (const c of candidates) {
      const el = document.querySelector(`[data-vessel="${c.id}"]`);
      const hit = document.elementFromPoint(c.cx, c.cy);
      if (el && hit && el.contains(hit)) return c;
    }
    return null;
  });
  expect(v, "no hoverable vessel marker inside the viewport").not.toBeNull();
  return v!;
}

/** Underway boats glide a few px per frame, so a single mouse.move can
 *  land on water the hull just left. Chase it: re-read the CURRENT
 *  center, move there, and poll until the tip's hover transition lands
 *  on full opacity. */
async function hoverVessel(page: Page, id: string) {
  await expect
    .poll(async () => {
      const pos = await page.evaluate((vid) => {
        const el = document.querySelector<HTMLElement>(`[data-vessel="${vid}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }, id);
      if (!pos) return "marker gone";
      await page.mouse.move(pos.cx, pos.cy);
      return page.evaluate(
        (vid) => getComputedStyle(document.querySelector(`[data-vessel="${vid}"] .tip`)!).opacity,
        id,
      );
    })
    .toBe("1");
}

test("the anchored point stays on the boat even with the tip showing", async ({ page }) => {
  await openMap(page);

  // Hover so the tip is actually rendered - the case that used to
  // inflate the box when labels were in flow. (The old zoom-in step
  // existed only to get labels past the declutter gate; hover renders
  // the tip at any zoom.)
  const v = await vesselNearCenter(page);
  await hoverVessel(page, v.id);
  const first = page.locator(`[data-vessel="${v.id}"]`);

  const m = await first.evaluate((el) => {
    const boatEl = el.querySelector<HTMLElement>(".boat img, .boat svg")!;
    const box = el.getBoundingClientRect(); // MapLibre pins its center to the lat/lon
    const boat = boatEl.getBoundingClientRect(); // where the hull is actually drawn
    return {
      offX: Math.abs(box.left + box.width / 2 - (boat.left + boat.width / 2)),
      offY: Math.abs(box.top + box.height / 2 - (boat.top + boat.height / 2)),
    };
  });

  // Sub-2px: the anchored box IS the boat. In-flow labels used to put
  // this at ~14px vertical.
  expect(m.offY).toBeLessThan(2);
  expect(m.offX).toBeLessThan(2);
});

test("boat info is hover-only: hidden at rest, tip on hover", async ({ page }) => {
  await openMap(page);

  const v = await vesselNearCenter(page);
  const tip = page.locator(`[data-vessel="${v.id}"] .tip`);
  // Hidden by default - the silhouettes carry the map.
  await expect(tip).toHaveCSS("opacity", "0");

  await hoverVessel(page, v.id);
  await expect(tip.locator(".nm")).not.toBeEmpty();

  // Unhover hides it again.
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCSS("opacity", "0");
});
