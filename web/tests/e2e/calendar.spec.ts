import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Service calendar + the map's boat-FAB drawer that leads to it.

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

test("calendar renders months, marked days, and day details", async ({ page }) => {
  await page.route("**/data/adjustments.json", (r) =>
    r.fulfill({ body: fixture("adjustments.json"), contentType: "application/json" }),
  );
  await page.route("**/data/pairs/index.json", (r) =>
    r.fulfill({ body: fixture("pairs-index.json"), contentType: "application/json" }),
  );

  await page.goto("/calendar/");
  await expect(page.getByRole("heading", { name: "Service calendar" })).toBeVisible();

  const august = page.getByTestId("month-2026-08");
  await expect(august).toBeVisible();
  await expect(august).toContainText("August 2026");
  await expect(august).toContainText(/\d+ cancelled/);

  // Aug 10 is marked; clicking it opens the day detail with direction labels.
  await august.getByRole("button", { name: /2026-08-10/ }).click();
  const detail = page.getByTestId("day-detail");
  await expect(detail).toContainText("Cancelled");
  await expect(detail).toContainText("06:30");
  await expect(detail).toContainText("tidal");
  await expect(detail).toContainText("Port Townsend");

  // The golden feed spans into December.
  await expect(page.getByTestId("month-2026-12")).toBeVisible();
});

test("boat FAB on the map opens the drawer with trips and calendar", async ({ page }) => {
  // Minimal fleet intercepts so the map page loads cleanly.
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill({ json: fleet }));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );

  await page.goto("/");
  await page.getByTestId("boat-fab").click();
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer).toContainText("Trip planner");
  await expect(drawer).toContainText("Service calendar");
  await expect(drawer).toContainText("Ambient mode");

  await drawer.getByRole("link", { name: /Service calendar/ }).click();
  await expect(page).toHaveURL(/\/calendar\/?/);
});
