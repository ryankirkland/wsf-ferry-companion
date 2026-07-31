import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Playwright runs with cwd = the config directory (web/).
const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

/** Serve fixture fleet data on the live-data paths; the exported site runs
 * with DATA_MODE=live in CI builds' production env semantics. */
async function interceptData(page: Page) {
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (route) =>
    route.fulfill({ json: fleet, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("**/data/vessels.json", (route) =>
    route.fulfill({
      body: fixture("vessels.json"),
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

test("the map page loads, draws the fleet, and switches modes", async ({ page }) => {
  await interceptData(page);
  await page.goto("/");

  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Talking to the Sound...")).toBeHidden({ timeout: 20_000 });

  // The full 21-vessel roster renders as markers.
  await expect(page.locator("[data-vessel]")).toHaveCount(21, { timeout: 15_000 });

  // Class icons: dims map every boat to its class, and lengths scale for
  // real (a Jumbo Mark II marker is wider than a Kwa-di Tabil's).
  await expect(page.locator('[data-vessel-class="Jumbo Mark II"]').first()).toBeVisible({
    timeout: 10_000,
  });
  const widths = await page
    .locator("[data-vessel]")
    .evaluateAll((els) => [...new Set(els.map((el) => (el as HTMLElement).style.width))]);
  expect(widths.length).toBeGreaterThanOrEqual(4); // several classes on screen

  // Markers must be absolutely positioned by MapLibre - if any stylesheet
  // out-orders .maplibregl-marker, boats render in document flow and stack
  // off their true positions (shipped once; never again).
  const positions = await page
    .locator("[data-vessel]")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
  expect(positions.every((p) => p === "absolute")).toBe(true);

  // And two markers must never share the exact same translate (flow-stacking
  // symptom): transforms should be dominated by distinct map positions.
  const transforms = await page
    .locator("[data-vessel]")
    .evaluateAll((els) => els.map((el) => el.style.transform));
  expect(new Set(transforms).size).toBeGreaterThan(transforms.length / 2);

  // The real quirk cases carry their states.
  await expect(page.locator("[data-vessel].stale").first()).toBeAttached();
  await expect(page.locator("[data-vessel].muted").first()).toBeAttached(); // yard

  // Mode switch flips the document attribute and a probed token.
  await page.getByRole("button", { name: "night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "night");
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(accent).toBe("#2fae8a");
});

test("ambient renders chromeless with a clock", async ({ page }) => {
  await interceptData(page);
  await page.goto("/ambient/");
  await expect(page.getByRole("button", { name: "auto" })).toHaveCount(0);
  await expect(page.getByLabel("Current time on Puget Sound")).toBeVisible();
});

test("the honest 404 page exists for CloudFront's error mapping", async ({ page }) => {
  await page.goto("/404.html", { waitUntil: "load" });
  await expect(page.getByText("This slip is empty.")).toBeVisible();
});

// Map chrome regressions found by reading the deployed page, not by any
// test: the FAB sat on top of the attribution (a licensing obligation),
// and only 5 of 20 terminals were ever labelled.
test("the boat FAB never covers the map attribution", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  const clash = await page.evaluate(() => {
    const a = document.querySelector(".maplibregl-ctrl-attrib");
    const fab = document.querySelector('[class*="fab"], [class*="Fab"]');
    if (!a || !fab) return "missing";
    const ar = a.getBoundingClientRect();
    const fr = fab.getBoundingClientRect();
    return !(ar.right < fr.left || ar.left > fr.right || ar.bottom < fr.top || ar.top > fr.bottom);
  });
  expect(clash).toBe(false);
});
