import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// F6 weather surfaces: the trip-page strip (both terminals at the viewed
// sailing's hour, AQI chips) and the map terminals' icon+temp chips.
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

test("trip page shows both terminals' weather with the EPA-colored AQI", async ({ page }) => {
  await interceptWeather(page);
  // Trip data 404s: the strip must still render on today's "now" hour.
  await page.route("**/data/pairs/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fares/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/stats/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/alerts.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/capacity.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fleet.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");

  const strip = page.getByTestId("weather-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Seattle");
  await expect(strip).toContainText("Bainbridge");
  await expect(strip).toContainText("°");
  // The fixture pins Seattle at AQI 54 Moderate - category name always
  // rides with the color.
  await expect(strip).toContainText("AQI 54 Moderate");
});

test("weather absent means an absent strip, not a broken one", async ({ page }) => {
  await page.route("**/data/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");
  await expect(page.getByRole("heading", { name: /Seattle/ })).toBeVisible();
  await expect(page.getByTestId("weather-strip")).toHaveCount(0);
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

  const chips = page.locator('[data-terminal] .wx');
  await expect(chips.first()).toBeVisible({ timeout: 20_000 });
  await expect(chips.first().locator("svg")).toBeAttached();
  await expect(chips.first()).toContainText("°");
});
