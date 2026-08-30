import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// F6 weather surfaces: the trip h1's per-terminal chips (both ends at
// the viewed sailing's hour, AQI included) and the map terminals'
// icon+temp chips.
// The weather doc is route-fulfilled from the committed fixture template,
// re-timed to "now" the same way the pair-day fixture is.

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

const soundToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function weatherDoc(baseMs: number): string {
  return fixture("weather.template.json")
    .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(baseMs + Number(n) * 60_000))
    .replace(/%%TODAY%%/g, soundToday())
    .replace(/%%NOW%%/g, new Date(baseMs).toISOString());
}

async function interceptWeather(page: Page) {
  await page.route("**/data/weather.json", (r) =>
    r.fulfill({ body: weatherDoc(Date.now()), contentType: "application/json" }),
  );
}

test("the h1's terminal names wear their weather, with the EPA-colored AQI", async ({ page }) => {
  await interceptWeather(page);
  // Trip data 404s: the chips must still render on today's "now" hour.
  await page.route("**/data/pairs/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fares/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/stats/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/alerts.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/capacity.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fleet.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");

  // The weather is worn by the h1 itself - a chip beside each terminal
  // name, no separate section.
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(page.getByTestId("wx-Seattle")).toBeVisible();
  await expect(h1).toContainText("°");
  // The fixture pins Seattle at AQI 54 Moderate - category name always
  // rides with the color.
  await expect(h1).toContainText("AQI 54 Moderate");
  // The fixture deliberately starts Bainbridge's hours 60 min out, so
  // "now" sits outside its horizon: the honest answer is a bare name
  // (the old strip printed a "no forecast" row here; the h1 placement
  // renders nothing instead).
  await expect(page.getByTestId("wx-Bainbridge Island")).toHaveCount(0);
});

test("weather absent means bare terminal names, not a broken h1", async ({ page }) => {
  await page.route("**/data/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");
  await expect(page.getByRole("heading", { name: /Seattle/ })).toBeVisible();
  await expect(page.getByTestId("wx-Seattle")).toHaveCount(0);
  await expect(page.getByTestId("wx-Bainbridge Island")).toHaveCount(0);
});

test("map terminals carry icon + temperature chips", async ({ page }) => {
  await interceptWeather(page);
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) =>
    r.fulfill({ body: JSON.stringify(fleet), contentType: "application/json" }),
  );
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );
  // Terminal markers require the dims + served-pairs index; without them
  // there are no markers for chips to ride.
  await page.route("**/data/terminals.json", (r) =>
    r.fulfill({ body: fixture("terminals.json"), contentType: "application/json" }),
  );
  await page.route("**/data/pairs/index.json", (r) =>
    r.fulfill({ body: fixture("pairs-index.json"), contentType: "application/json" }),
  );
  await page.route("**/assets/vessels/*-t.png", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");

  // Seattle: an always-on chip. DOM-order .first() is Anacortes, whose
  // chip is chip-late (dense northern cluster) and correctly hidden
  // below the declutter zoom - phone-ish framings sit under it.
  const chip = page.locator('[data-terminal="7"] .wx');
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(chip.locator("svg")).toBeAttached();
  await expect(chip).toContainText("°");
});
