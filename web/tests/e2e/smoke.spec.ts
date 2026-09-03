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

/** A 1x1 PNG for /assets/vessels/*.png, so the card's onError fallback is
 *  not what the positive test ends up exercising. */
async function interceptClassDrawing(page: Page) {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/assets/vessels/*.png", (route) =>
    route.fulfill({ body: pixel, contentType: "image/png" }),
  );
}

test("the map page loads, draws the fleet, and switches modes", async ({ page }) => {
  await interceptData(page);
  await page.goto("/");

  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
  // The loading ferry (with the voice line as its accessible name) goes
  // with the veil once the map is up.
  await expect(page.getByTestId("loading-ferry")).toBeHidden({ timeout: 20_000 });

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

// The class drawing on the vessel card: WSDOT's own artwork, mirrored.
// It must sit AFTER the operational answer (where the boat is), and it
// must remove itself rather than leave a broken frame if the asset is
// missing - a class commissioned since the last mirror run.
test("the vessel card shows the WSDOT class drawing", async ({ page }) => {
  await interceptData(page);
  // Serve the asset ourselves: the mirrored drawings are gitignored (they
  // are WSDOT artwork, kept out of the repo), so a test that relied on the
  // real files would pass locally and never in CI.
  await interceptClassDrawing(page);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    // Vessel markers render the WSDOT drawing img (traced svg only as
    // fallback) - select by the data attribute, not the graphic's tag.
    const el = document.querySelector("[data-vessel]");
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const card = page.getByTestId("vessel-card");
  await expect(card).toBeVisible();

  const drawing = page.getByTestId("class-drawing");
  await expect(drawing).toBeVisible();
  await expect(drawing).toContainText("WSDOT class drawing");
  // Captioned as a class drawing, never as a portrait of this hull.
  await expect(drawing.locator("img")).toHaveAttribute("alt", /class ferry$/);

  // The status the rider tapped for comes first.
  const order = await card.evaluate((el) =>
    [...el.children].map((c) => c.getAttribute("data-testid") ?? c.tagName),
  );
  expect(order.indexOf("class-drawing")).toBeGreaterThan(order.indexOf("H2"));
});

test("a missing class drawing leaves no broken frame", async ({ page }) => {
  await interceptData(page);
  await page.route("**/assets/vessels/*.png", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    // Vessel markers render the WSDOT drawing img (traced svg only as
    // fallback) - select by the data attribute, not the graphic's tag.
    const el = document.querySelector("[data-vessel]");
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByTestId("vessel-card")).toBeVisible();
  await expect(page.getByTestId("class-drawing")).toHaveCount(0);
});

// Two first-visit regressions found by the 2026-08-17 new-user walk.
test("the consent banner never blocks the boat FAB", async ({ page }) => {
  await interceptData(page);
  await page.goto("/");
  await page.waitForTimeout(2500);
  // Banner visible (fresh visitor) AND the FAB still takes the tap. No
  // tight click timeout: an overlapping banner fails as "element
  // intercepts pointer events" at any timeout, which is the regression
  // this guards - a short deadline only adds load-flakiness on busy
  // runners.
  await expect(page.getByTestId("consent-banner")).toBeVisible();
  await page.locator('[class*="fab"]').first().click();
  await expect(page.getByRole("link", { name: /Sailing schedule/ })).toBeVisible();
});

test("the data-source notice shows once, names the sources, and stays dismissed", async ({
  page,
}) => {
  await interceptData(page);
  await page.goto("/");

  const notice = page.getByTestId("data-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Washington State Ferries");
  await expect(notice).toContainText("National Weather Service");
  await expect(notice).toContainText("AirNow");
  // The feedback address is a real mailto, not just text.
  await expect(notice.locator('a[href^="mailto:"]')).toBeVisible();

  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toHaveCount(0);

  // Dismissal persists across reloads.
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("data-notice")).toHaveCount(0);
});

test("the landing page hydrates without a React error", async ({ page }) => {
  // The masthead clock was baked at BUILD time into the static HTML, so
  // every real visitor hydrated against a stale time string and React
  // threw #418. The server now renders a placeholder the client swaps.
  await interceptData(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForTimeout(3000);
  expect(errors.filter((m) => /418|hydrat/i.test(m))).toEqual([]);
  // And the clock is a real time, not the placeholder.
  await expect(page.locator("body")).not.toContainText("--:--");
});

test("the staleness banner speaks the DATA's clock, not the page's", async ({ page }) => {
  // Caught live during the 2026-08-19 WSDOT outage: the snapshot FILE
  // kept serving while its contents froze, and the banner tracked the
  // rider's load time - overstating freshness during the exact event
  // it exists for. A fresh page load over a 40-minute-old snapshot must
  // say the snapshot's time.
  const frozenAt = Date.now() - 40 * 60_000;
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date(frozenAt).toISOString();
  await interceptData(page);
  await page.route("**/data/fleet.json", (r) =>
    r.fulfill({ body: JSON.stringify(fleet), contentType: "application/json" }),
  );
  await page.goto("/");

  const banner = page.locator('[class*="staleBanner"]');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  const frozenClock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(frozenAt));
  await expect(banner).toContainText(frozenClock);
});
