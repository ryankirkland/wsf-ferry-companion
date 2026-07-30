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
