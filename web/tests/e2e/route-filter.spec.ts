import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Route filter (docs/features/realtime-map.md): checkboxes hide a
// route's boats and exclusive terminals; the choice persists per device.

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

const json = (body: unknown) => ({
  body: JSON.stringify(body),
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
});

const fleetFix = JSON.parse(fixture("fleet-frame-0.json")) as {
  vessels: { id: number; routes: string[] }[];
};
const sanJuanBoat = fleetFix.vessels.find((v) => v.routes.join() === "ana-sj")!;
const bremertonBoat = fleetFix.vessels.find((v) => v.routes.includes("sea-br"))!;

async function openMap(page: Page) {
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill(json(fleet)));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );
  await page.route("**/data/terminals.json", (r) =>
    r.fulfill({ body: fixture("terminals.json"), contentType: "application/json" }),
  );
  await page.route("**/data/pairs/index.json", (r) =>
    r.fulfill({ body: fixture("pairs-index.json"), contentType: "application/json" }),
  );
  await page.route("**/assets/vessels/*-t.png", (r) => r.fulfill({ status: 404, body: "" }));
  // First-visit notice cards sit over the bottom-left control column
  // until dismissed - these specs model a user past that.
  await page.addInitScript(() => {
    localStorage.setItem("wsf_analytics_consent_seen", "1");
    localStorage.setItem("fs.data-notice-seen:v1", "1");
  });
  await page.goto("/");
  await page.waitForSelector("[data-vessel] .boat svg");
  await page.waitForSelector('[data-terminal="1"]', { state: "attached" });
}

test("unchecking a route hides its boats and exclusive terminals; persists", async ({ page }) => {
  await openMap(page);

  const sjBoat = page.locator(`[data-vessel="${sanJuanBoat.id}"]`);
  const brBoat = page.locator(`[data-vessel="${bremertonBoat.id}"]`);
  const anacortes = page.locator('[data-terminal="1"]');
  await expect(sjBoat).toHaveCount(1);

  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Anacortes - San Juans" }).uncheck();

  await expect(sjBoat).not.toBeVisible();
  await expect(brBoat).toBeVisible();
  await expect(anacortes).not.toBeVisible();
  // Seattle serves two routes; hiding one never hides the terminal.
  await expect(page.locator('[data-terminal="7"]')).toBeVisible();

  // The preference survives a reload. (Wait on a VISIBLE boat - the
  // first [data-vessel] in DOM order may be a correctly-hidden one.)
  await page.reload();
  await page.waitForSelector(`[data-vessel="${bremertonBoat.id}"] .boat svg`);
  await page.waitForSelector('[data-terminal="1"]', { state: "attached" });
  await expect(page.locator(`[data-vessel="${sanJuanBoat.id}"]`)).not.toBeVisible();
  // The circle carries a visible-routes badge while filtering.
  await expect(page.getByTestId("route-count")).toHaveText("7");

  // Show all restores everything.
  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Show all routes" }).click();
  await expect(page.locator(`[data-vessel="${sanJuanBoat.id}"]`)).toBeVisible();
  await expect(page.locator('[data-terminal="1"]')).toBeVisible();
});

test("out-of-service boats get their own toggle; persists", async ({ page }) => {
  await openMap(page);

  // Sealth (28) is tied up: insvc false, no routes - unreachable by the
  // route checkboxes, which is exactly why the toggle exists.
  const oosBoat = page.locator('[data-vessel="28"]');
  await expect(oosBoat).toBeVisible();

  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Out-of-service boats" }).uncheck();

  await expect(oosBoat).not.toBeVisible();
  // In-service boats are untouched.
  await expect(page.locator(`[data-vessel="${bremertonBoat.id}"]`)).toBeVisible();

  await page.reload();
  await page.waitForSelector(`[data-vessel="${bremertonBoat.id}"] .boat svg`);
  await expect(page.locator('[data-vessel="28"]')).not.toBeVisible();

  await page.getByRole("button", { name: "Routes", exact: true }).click();
  await page.getByRole("checkbox", { name: "Out-of-service boats" }).check();
  await expect(page.locator('[data-vessel="28"]')).toBeVisible();
});
