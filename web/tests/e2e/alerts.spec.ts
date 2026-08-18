import { expect, test, type Page } from "@playwright/test";

// Alerts UI E2E. The signed-in state is created by seeding localStorage
// with the exact keys amazon-cognito-identity-js reads; the SDK decodes
// token payloads client-side without signature verification, so an
// unsigned JWT with a future exp is a valid session as far as the UI is
// concerned. The subscription API itself is route-intercepted.

const CLIENT_ID = "57ckrpr8h75p2hrpf72so0leu7";
const EMAIL = "rider@example.com";

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.x`;
}

async function seedSession(page: Page) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const iat = Math.floor(Date.now() / 1000) - 60;
  const id = fakeJwt({ sub: "user-1", email: EMAIL, exp, iat, token_use: "id" });
  const access = fakeJwt({ sub: "user-1", exp, iat, token_use: "access", username: EMAIL });
  const p = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  await page.addInitScript(
    ({ prefix, email, idT, accessT }) => {
      localStorage.setItem(`${prefix}.LastAuthUser`, email);
      localStorage.setItem(`${prefix}.${email}.idToken`, idT);
      localStorage.setItem(`${prefix}.${email}.accessToken`, accessT);
      localStorage.setItem(`${prefix}.${email}.refreshToken`, "fake-refresh");
      localStorage.setItem(`${prefix}.${email}.clockDrift`, "0");
    },
    { prefix: p, email: EMAIL, idT: id, accessT: access },
  );
}

const SUB = {
  id: "0007-0003-1600-1900",
  dep: 7,
  arr: 3,
  dep_name: "Seattle",
  arr_name: "Bainbridge Island",
  route_id: 5,
  window_start: "16:00",
  window_end: "19:00",
  created_at: 1750000000,
};

test("signed-out visitors get the pitch and the door", async ({ page }) => {
  await page.goto("/alerts/");
  const card = page.getByTestId("signed-out");
  await expect(card).toContainText("one plain-language email");
  await expect(card.getByRole("link", { name: /Sign in or create/ })).toHaveAttribute(
    "href",
    /\/account\/?\?next=/,
  );
});

test("signed-in: list, add with window chips, delete", async ({ page }) => {
  await seedSession(page);
  const subs = [SUB];
  await page.route("**/v1/subscriptions", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { subscriptions: subs } });
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    subs.push({ ...SUB, id: "new", window_start: body.window_start, window_end: body.window_end });
    return route.fulfill({ status: 201, json: { id: "new" } });
  });
  await page.route("**/v1/subscriptions/*", (route) => {
    subs.pop();
    return route.fulfill({ json: { deleted: SUB.id } });
  });

  await page.goto("/alerts/");
  await expect(page.getByText(EMAIL)).toBeVisible();
  const list = page.getByTestId("sub-list");
  await expect(list).toContainText("Seattle → Bainbridge Island");
  await expect(list).toContainText("16:00-19:00");

  // Add: crossing select + Morning preset chip.
  await page.getByLabel("Crossing").selectOption({ label: "Seattle → Bainbridge Island" });
  await page.getByRole("button", { name: /Morning 05:00-09:00/ }).click();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await expect(list.locator("li")).toHaveCount(2);

  await list.locator("li").nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(list.locator("li")).toHaveCount(1);
});

test("window validation blocks inverted ranges client-side", async ({ page }) => {
  await seedSession(page);
  await page.route("**/v1/subscriptions", (r) => r.fulfill({ json: { subscriptions: [] } }));
  await page.goto("/alerts/");
  await page.getByLabel("Crossing").selectOption({ label: "Seattle → Bainbridge Island" });
  await page.getByLabel("Window start").fill("19:00");
  await page.getByLabel("Window end").fill("16:00");
  await expect(page.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  await expect(page.getByText("must start before it ends")).toBeVisible();
});

test("unsubscribe page: fragment token, button-gated, POSTs once", async ({ page }) => {
  let posts = 0;
  await page.route("**/v1/unsubscribe*", (route) => {
    posts += 1;
    return route.fulfill({ json: { unsubscribed: true, removed: 2 } });
  });
  await page.goto("/unsubscribe/#tok123");
  await expect(page.getByTestId("unsubscribe-card")).toContainText("stops all Ferry Sound alert emails");
  expect(posts).toBe(0); // landing alone must never unsubscribe
  await page.getByRole("button", { name: /Unsubscribe from everything/ }).click();
  await expect(page.getByTestId("unsubscribed")).toContainText("2 subscriptions removed");
  expect(posts).toBe(1);
});

test("account page renders the sign-in machine", async ({ page }) => {
  await page.goto("/account/");
  const form = page.getByTestId("account-form");
  await expect(form.getByLabel("Email")).toBeVisible();
  await expect(form.getByLabel("Password")).toBeVisible();
  await form.getByRole("button", { name: /Create an account/ }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByText("At least 12 characters")).toBeVisible();
});

test("pair pages link to prefilled alerts", async ({ page }) => {
  // The link renders only once the pairs index resolves a route_id.
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const index = readFileSync(
    path.resolve(process.cwd(), "public/dev-fixtures/pairs-index.json"),
    "utf8",
  );
  await page.route("**/data/pairs/index.json", (r) =>
    r.fulfill({ body: index, contentType: "application/json" }),
  );
  await page.route("**/data/pairs/7-3/*", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fleet.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/alerts.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("**/data/fares/*", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/trip/seattle-bainbridge-island/");
  await expect(page.getByRole("link", { name: "Get alerts for this run" })).toHaveAttribute(
    "href",
    /\/alerts\/?\?dep=7&arr=3/,
  );
});

test("boat FAB survives client-side navigation back to the map", async ({ page }) => {
  // Regression: navigating /alerts -> wordmark -> map left the FAB
  // missing until a hard refresh (Ryan, 2026-07-30, on production).
  await page.route("**/data/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/alerts/");
  await page.getByRole("link", { name: /Ferry/ }).first().click();
  await expect(page).toHaveURL(/\/$/);
  const fab = page.getByTestId("boat-fab");
  await expect(fab).toBeVisible();
  const pos = await fab.evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, rect: el.getBoundingClientRect().toJSON() };
  });
  expect(pos.position).toBe("fixed");
  const viewport = page.viewportSize()!;
  expect(pos.rect.bottom).toBeLessThanOrEqual(viewport.height);
  expect(pos.rect.left).toBeLessThan(100); // bottom-left corner, on screen
});

// From the 2026-08-18 sign-up walk: a signup error rode into the
// forgot-password screen, where "User already exists" read as a statement
// about the reset.
test("switching auth flows clears the previous flow's error", async ({ page }) => {
  await page.route("**/cognito-idp.us-west-2.amazonaws.com/**", (r) =>
    r.fulfill({
      status: 400,
      contentType: "application/x-amz-json-1.1",
      body: JSON.stringify({ __type: "UsernameExistsException", message: "User already exists" }),
    }),
  );
  await page.goto("/account/");
  await page.getByText(/create an account/i).click();
  await page.locator('input[type="email"]').fill("someone@example.com");
  await page.locator('input[type="password"]').first().fill("Long-Enough-Password-9");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page.locator('[class*="error"]')).toContainText(/already has an account/);

  // Now walk to forgot-password: the signup error must not follow.
  await page.getByRole("button", { name: /back to sign in/i }).click();
  await page.getByRole("button", { name: /forgot password/i }).click();
  await expect(page.locator('[class*="error"]')).toHaveCount(0);
});
