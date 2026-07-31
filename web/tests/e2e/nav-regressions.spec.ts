import { expect, test } from "@playwright/test";

test("back-button to map after drawer navigation", async ({ page }) => {
  await page.route("**/data/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.getByTestId("boat-fab").click();          // open drawer
  await page.getByRole("link", { name: /Email alerts/ }).click(); // navigate away with drawer open
  await expect(page).toHaveURL(/alerts/);
  await page.goBack();                                  // browser back
  await expect(page).toHaveURL(/\/$/);
  const fab = page.getByTestId("boat-fab");
  await expect(fab).toBeVisible({ timeout: 5000 });
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer).toHaveAttribute("aria-hidden", "true"); // drawer should not be stuck open
  const backdropCount = await page.locator("[class*='backdrop']").count();
  expect(backdropCount).toBe(0);
});

test("trip page wordmark back to map", async ({ page }) => {
  await page.route("**/data/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");
  await page.getByRole("link", { name: /Ferry/ }).first().click();
  await expect(page.getByTestId("boat-fab")).toBeVisible({ timeout: 5000 });
});

test("trip vessel chip deep-links to a selected boat on the map", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const fx = (n: string) => readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", n), "utf8");
  const fleet = JSON.parse(fx("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill({ json: fleet }));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fx("vessels.json"), contentType: "application/json" }),
  );
  const target = fleet.vessels.find((v: { state: string }) => v.state === "underway");
  await page.goto(`/?vessel=${target.id}`);
  const card = page.getByTestId("vessel-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(target.name);
  // And the card is not a dead end: it links onward to the run's schedule.
  await expect(card.getByRole("link", { name: /Next sailings/ })).toBeVisible();
});

test("drawer offers sign-in to a signed-out visitor", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const fx = (n: string) => readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", n), "utf8");
  const fleet = JSON.parse(fx("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  await page.route("**/data/fleet.json", (r) => r.fulfill({ json: fleet }));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fx("vessels.json"), contentType: "application/json" }),
  );
  await page.goto("/");
  await page.getByTestId("boat-fab").click();
  const drawer = page.getByTestId("nav-drawer");
  await expect(drawer.getByRole("link", { name: /Sign in/ })).toHaveAttribute(
    "href",
    /\/account\/?\?next=/,
  );
});
