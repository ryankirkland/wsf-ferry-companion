import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Inline route schedule on the vessel card (docs/features/realtime-map.md):
// tapping "Next sailings" expands the current pair's day schedule in place
// (no navigation), with a persistent collapse chevron and an in-card day
// picker bounded to the same today..+13 horizon as the trip planner.

const DEP = 7;
const ARR = 4; // seattle-bremerton, matches the "Chimacum" fixture vessel below
const MIN = 60_000;

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

const soundToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const shiftYmd = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function resolveTemplate(raw: string, baseMs: number): string {
  return raw
    .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(baseMs + Number(n) * MIN))
    .replace(/%%ISO(-?\d+)%%/g, (_, n) => new Date(baseMs + Number(n) * MIN).toISOString())
    .replace(/%%TODAY%%/g, soundToday())
    .replace(/%%NOW%%/g, new Date(baseMs).toISOString());
}

function buildDay(baseMs: number) {
  const day = JSON.parse(resolveTemplate(fixture("pair-day.template.json"), baseMs));
  day.pair = { dep: DEP, arr: ARR };
  day.adjustments = [];
  return day;
}

async function interceptData(page: Page, day: unknown, lateBySeconds?: number) {
  const json = (body: unknown) => ({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
  });
  const fleet = JSON.parse(fixture("fleet-frame-0.json"));
  fleet.generated_at = new Date().toISOString();
  if (lateBySeconds !== undefined) {
    const target = (fleet.vessels as Array<Record<string, unknown>>).find((v) => v.id === 74);
    if (!target || typeof target.sched !== "string") throw new Error("missing Chimacum schedule");
    target.left = new Date(Date.parse(target.sched) + lateBySeconds * 1000).toISOString();
  }
  await page.route("**/data/fleet.json", (r) => r.fulfill(json(fleet)));
  await page.route("**/data/vessels.json", (r) =>
    r.fulfill({ body: fixture("vessels.json"), contentType: "application/json" }),
  );
  await page.route("**/data/terminals.json", (r) =>
    r.fulfill({ body: fixture("terminals.json"), contentType: "application/json" }),
  );
  const today = soundToday();
  await page.route(`**/data/pairs/${DEP}-${ARR}/*.json`, (r) => {
    const wanted = r.request().url().endsWith(`/${today}.json`);
    return wanted ? r.fulfill(json(day)) : r.fulfill({ status: 404, body: "" });
  });
}

test("Next sailings expands the current route's schedule inline and collapses back", async ({
  page,
}) => {
  const baseMs = Date.now();
  const day = buildDay(baseMs);
  await interceptData(page, day);

  // Chimacum (id 74) is underway on dep 7 / arr 4 in the fixture fleet.
  await page.goto("/?vessel=74");
  const card = page.getByTestId("vessel-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Chimacum");

  const origin = card.getByTestId("route-origin");
  const destination = card.getByTestId("route-destination");
  await expect(origin).toContainText("Left at");
  await expect(origin).toContainText("Seattle");
  await expect(origin).toContainText("1 min late");
  await expect(destination).toContainText("Est. arrival");
  await expect(destination).toContainText("Bremerton");
  const scheduleComparison = card.getByTestId("schedule-comparison");
  await expect(scheduleComparison).toContainText("Scheduled 12:50 AM");
  await expect(scheduleComparison).not.toContainText("late");

  const [leftTime, originTerminal, eta, destinationTerminal] = await Promise.all([
    origin.locator("span").nth(0).boundingBox(),
    origin.locator("span").last().boundingBox(),
    destination.locator("span").nth(0).boundingBox(),
    destination.locator("span").nth(1).boundingBox(),
  ]);
  expect(leftTime).not.toBeNull();
  expect(originTerminal).not.toBeNull();
  expect(eta).not.toBeNull();
  expect(destinationTerminal).not.toBeNull();
  expect(leftTime!.y).toBeLessThan(originTerminal!.y);
  expect(eta!.y).toBeLessThan(destinationTerminal!.y);

  const toggle = card.getByRole("button", { name: /Next sailings/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  const schedule = page.getByTestId("vessel-schedule");
  await expect(schedule).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // Same day data and row rendering as the trip planner: 8 sailings, with
  // everything before the next boat collapsed behind the earlier-sailings
  // toggle (DepartureList's existing behavior, reused as-is).
  const rows = schedule.getByTestId("departures").locator("li");
  await expect(rows).toHaveCount(5);
  await schedule.getByRole("button", { name: /Show \d+ earlier sailing/ }).click();
  await expect(rows).toHaveCount(8);

  // Today..+13 day picker, defaulting to today.
  const chips = schedule.getByTestId("date-strip").getByRole("tab");
  await expect(chips).toHaveCount(14);
  await expect(chips.first()).toHaveAttribute("aria-selected", "true");

  // No navigation happened - still the map, same vessel selected.
  await expect(page).toHaveURL(/\/\?vessel=74/);

  // The chevron/toggle stays reachable and collapses back to the base card.
  await toggle.click();
  await expect(schedule).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("matching displayed minutes do not claim a one-minute delay", async ({ page }) => {
  const baseMs = Date.now();
  await interceptData(page, buildDay(baseMs), 45);

  await page.goto("/?vessel=74");
  const card = page.getByTestId("vessel-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId("route-origin")).toContainText("Left at 12:50 AM");
  await expect(card.getByTestId("route-origin")).not.toContainText("late");
  await expect(card.getByTestId("schedule-comparison")).toHaveText("Scheduled 12:50 AM");
});

test("switching days inside the expanded schedule shows that day's sailings", async ({ page }) => {
  const baseMs = Date.now();
  const day = buildDay(baseMs);
  await interceptData(page, day);

  await page.goto("/?vessel=74");
  await page.getByTestId("vessel-card").getByRole("button", { name: /Next sailings/ }).click();
  const schedule = page.getByTestId("vessel-schedule");
  await expect(schedule.getByTestId("departures").locator("li")).toHaveCount(5);

  // Tomorrow's file 404s in this fixture - an honest empty state, not a crash.
  const tomorrow = shiftYmd(soundToday(), 1);
  await schedule.getByTestId("date-strip").getByRole("tab", { name: "Tomorrow" }).click();
  await expect(page.getByText(tomorrow)).toHaveCount(0); // no stray raw date leaks into copy
  await expect(schedule.getByTestId("schedule-empty")).toContainText("No sailings this day");
});

test("a boat with no current route/pair shows no Next sailings control", async ({ page }) => {
  await interceptData(page, buildDay(Date.now()));

  // Tokitae (id 68) is "yard" state at synthetic terminal 122 - no PAIRS match.
  await page.goto("/?vessel=68");
  const card = page.getByTestId("vessel-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Tokitae");
  await expect(card.getByRole("button", { name: /Next sailings/ })).toHaveCount(0);
});

// Found while building this feature: a vessel with no class drawing renders
// a shorter card, which puts the "Next sailings" toggle in the same
// bottom-left footprint as the boat FAB. The FAB used to win the z-index
// fight and drew its circle over the toggle's label. The card must always
// win that fight - it's the open surface, the FAB is chrome underneath it.
test("the boat FAB never covers the vessel card's Next sailings control", async ({ page }) => {
  await interceptData(page, buildDay(Date.now()));
  // No class-drawing route intercepted: the drawing 404s and removes
  // itself, producing the shortest (worst-case) card height.
  await page.route("**/assets/vessels/*.png", (r) => r.fulfill({ status: 404, body: "" }));

  await page.goto("/?vessel=74");
  const toggle = page.getByTestId("vessel-card").getByRole("button", { name: /Next sailings/ });
  await expect(toggle).toBeVisible({ timeout: 20_000 });

  const fab = page.getByTestId("boat-fab");
  const clash = await page.evaluate(() => {
    const t = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Next sailings"),
    );
    const f = document.querySelector('[data-testid="boat-fab"]');
    if (!t || !f) return "missing";
    const tr = t.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const overlaps = !(tr.right < fr.left || tr.left > fr.right || tr.bottom < fr.top || tr.top > fr.bottom);
    if (!overlaps) return false;
    // They occupy the same screen region - the card must be the one drawn
    // on top (higher effective stacking), never the FAB.
    return Number(getComputedStyle(t.closest('[data-testid="vessel-card"]')!).zIndex) <=
      Number(getComputedStyle(f).zIndex);
  });
  expect(clash).toBe(false);
  await expect(fab).toBeVisible(); // still present underneath, not removed
});
