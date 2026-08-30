import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Trip planner E2E against the static export, all four /data documents
// route-intercepted. The pair-day template re-times around "now" so a
// single page load shows departed, boarding, tight, comfortable, and a
// struck tidal cancellation at once - every promise of F2 in one screen.

const SLUG = "seattle-bainbridge-island";
const DEP = 7;
const ARR = 3;
const MIN = 60_000;

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "public/dev-fixtures", name), "utf8");

const HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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

interface Row {
  depart: string;
  depart_ms: number;
  vessel_id: number;
  vessel: string;
}

function buildDay(baseMs: number) {
  const day = JSON.parse(resolveTemplate(fixture("pair-day.template.json"), baseMs)) as {
    sailings: Row[];
    adjustments: unknown[];
  };
  // Strike the +55 min sailing as a matched tidal cancel.
  const struck = day.sailings.find((s) => s.depart_ms === baseMs + 55 * MIN)!;
  day.adjustments = [
    {
      type: "cancel",
      time_local: HHMM.format(new Date(struck.depart_ms)),
      terminal_id: DEP,
      tidal: true,
      matched: true,
    },
  ];
  return day;
}

function buildFleet(day: { sailings: Row[] }, baseMs: number) {
  const departed = day.sailings.find((s) => s.depart_ms === baseMs - 8 * MIN)!;
  const boarding = day.sailings.find((s) => s.depart_ms === baseMs + 6 * MIN)!;
  const vessel = (over: Record<string, unknown>) => ({
    id: 0,
    name: "",
    lat: 47.6,
    lon: -122.4,
    speed: 0,
    heading: 90,
    state: "docked",
    insvc: true,
    age_s: 8,
    dep: DEP,
    arr: ARR,
    left: null,
    eta: null,
    eta_basis: null,
    sched: null,
    routes: ["sea-bi"],
    pos: 1,
    ...over,
  });
  return {
    v: 1,
    generated_at: new Date(baseMs).toISOString(),
    vessels: [
      vessel({
        id: departed.vessel_id,
        name: departed.vessel,
        state: "underway",
        speed: 16,
        sched: departed.depart,
        left: new Date(departed.depart_ms + 2 * MIN).toISOString(),
        eta: new Date(departed.depart_ms + 30 * MIN).toISOString(),
        eta_basis: "history",
      }),
      vessel({ id: boarding.vessel_id, name: boarding.vessel, sched: boarding.depart }),
    ],
  };
}

async function interceptTripData(page: Page, baseMs: number) {
  const index = JSON.parse(fixture("pairs-index.json")) as {
    pairs: { dep: number; arr: number; route_id: number | null }[];
  };
  const routeId = index.pairs.find((p) => p.dep === DEP && p.arr === ARR)?.route_id ?? null;
  const day = buildDay(baseMs);
  const today = soundToday();
  const json = (body: unknown) => ({
    body: JSON.stringify(body),
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
  });

  await page.route("**/data/pairs/index.json", (r) => r.fulfill(json(index)));
  await page.route(`**/data/pairs/${DEP}-${ARR}/*.json`, (r) => {
    const wanted = r.request().url().endsWith(`/${today}.json`);
    return wanted ? r.fulfill(json(day)) : r.fulfill({ status: 404, body: "" });
  });
  await page.route(`**/data/fares/${DEP}-${ARR}.json`, (r) =>
    r.fulfill({ body: fixture("fares-14-5.json"), contentType: "application/json" }),
  );
  await page.route("**/data/alerts.json", (r) =>
    r.fulfill(
      json({
        v: 1,
        generated_at: new Date(baseMs).toISOString(),
        watermark: "999:0",
        alerts: [
          {
            id: 999,
            title: "Seattle / Bainbridge - sample service notice",
            text: "Fixture alert body for E2E.",
            published: new Date(baseMs).toISOString(),
            route_ids: routeId === null ? [] : [routeId],
            all_routes: routeId === null,
          },
          {
            // WSF's most common shape: RouteAlertText is the title typed
            // again, drifting only in spacing. It must render once.
            id: 998,
            title: "Sea/BI - ADA Alert - Tillikum #2 elevator out of service",
            text: "Sea/BI- ADA Alert - Tillikum #2 elevator out of service.",
            published: new Date(baseMs - 90 * MIN).toISOString(),
            route_ids: routeId === null ? [] : [routeId],
            all_routes: routeId === null,
          },
        ],
      }),
    ),
  );
  await page.route("**/data/fleet.json", (r) => r.fulfill(json(buildFleet(day, baseMs))));
  await page.route("**/data/vessels.json", (r) => r.fulfill(json({ v: 1, vessels: [] })));
  return { day };
}

test("trip page answers run-or-relax with live signals", async ({ page }) => {
  const baseMs = Date.now();
  await interceptTripData(page, baseMs);
  await page.goto(`/trip/${SLUG}/`);

  // The answer line: next boat is the dock-confirmed +6 min sailing.
  const answer = page.getByTestId("answer-line");
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await expect(answer).toContainText(/at the dock - leaves in \d+ min/i);

  // Alert banner is route-matched, expandable, and stamped: the fixture
  // alert is published "now", so the stamp is a Sound-time clock reading.
  const banner = page.getByTestId("alert-banner");
  await expect(banner).toContainText("sample service notice");
  await expect(banner.locator("summary time")).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);
  await banner.locator("summary").click();
  await expect(banner).toContainText("Fixture alert body for E2E.");

  // A bulletin whose text merely repeats its title prints the sentence
  // once - no grey echo under the heading (owner's call, 2026-08-30).
  const echoed = "Sea/BI - ADA Alert - Tillikum #2 elevator out of service";
  await expect(banner.getByText(echoed, { exact: false })).toHaveCount(1);
  await expect(banner.locator("p")).toHaveCount(1);

  // Earlier sailings are collapsed behind an explicit toggle.
  await page.getByRole("button", { name: /Show 3 earlier sailings/ }).click();

  const rows = page.getByTestId("departures").locator("li");
  await expect(rows).toHaveCount(8);

  // Every signal band on one screen.
  await expect(page.locator('[data-state="departed"]')).toHaveCount(1);
  await expect(page.locator('[data-state="departed"]')).toContainText(/Sailed at .*\+2 min/);
  await expect(page.locator('[data-state="gone"]')).toHaveCount(2);
  await expect(page.locator('[data-state="boarding"]')).toHaveCount(1);
  await expect(page.locator('[data-state="tight"]')).toHaveCount(1);
  await expect(page.locator('[data-state="comfortable"]')).toHaveCount(2);

  // The struck tidal cancellation renders with its reason.
  const cancelled = page.locator('[data-state="cancelled"]');
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled).toContainText("tidal cancellation");
  await expect(cancelled).toContainText("Cancelled");

  // Fares: the LineItemLookup regression pair renders $7.10, honestly labeled.
  await expect(page.getByText("adult $7.10 one-way")).toBeVisible();
  await page.getByTestId("fares-panel").locator("summary").click();
  await expect(page.getByText("Senior (age 65 & over) / Disability")).toBeVisible();
  await expect(page.getByText(/Fares for travel \d{4}-\d{2}-\d{2}, retrieved/)).toBeVisible();

  // Date strip: exactly the published 14-day horizon.
  const chips = page.getByTestId("date-strip").getByRole("tab");
  await expect(chips).toHaveCount(14);
  await expect(chips.first()).toHaveText("Today");
});

test("empty days and out-of-range dates degrade honestly", async ({ page }) => {
  const baseMs = Date.now();
  await interceptTripData(page, baseMs);

  // In-horizon date whose file 404s: a plain no-sailings state.
  await page.goto(`/trip/${SLUG}/?date=${shiftYmd(soundToday(), 5)}`);
  await expect(page.getByTestId("empty-day")).toContainText("No sailings this day");

  // Out of range either way clamps to today with an honest note.
  await page.goto(`/trip/${SLUG}/?date=2099-01-01`);
  await expect(page.getByText(/Schedules are published 14 days out/)).toBeVisible();

  await page.goto(`/trip/${SLUG}/?date=1999-01-01`);
  await expect(page.getByText(/Past sailings aren't browsable/)).toBeVisible();
});

test("an exhausted day previews tomorrow's first sailings", async ({ page }) => {
  const baseMs = Date.now();
  await interceptTripData(page, baseMs);

  // Override (Playwright routes are LIFO): today has only past sailings,
  // tomorrow's file exists in full.
  const day = buildDay(baseMs);
  const pastOnly = { ...day, sailings: day.sailings.filter((s) => s.depart_ms < baseMs) };
  const today = soundToday();
  const tomorrow = shiftYmd(today, 1);
  await page.route(`**/data/pairs/${DEP}-${ARR}/*.json`, (r) => {
    const url = r.request().url();
    const body = url.endsWith(`/${today}.json`)
      ? pastOnly
      : url.endsWith(`/${tomorrow}.json`)
        ? day
        : null;
    return body
      ? r.fulfill({ body: JSON.stringify(body), contentType: "application/json" })
      : r.fulfill({ status: 404, body: "" });
  });

  await page.goto(`/trip/${SLUG}/`);
  const empty = page.getByTestId("empty-day");
  await expect(empty).toContainText("No more sailings today");
  await expect(empty).toContainText("Tomorrow starts:");
  await empty.getByRole("button", { name: "See tomorrow's schedule" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${tomorrow}`));
  await expect(page.getByTestId("departures").locator("li")).toHaveCount(8);
});

test("picker filters to real mates and remembers your run", async ({ page }) => {
  const baseMs = Date.now();
  await interceptTripData(page, baseMs);

  await page.goto(`/trip/${SLUG}/`);
  await expect(page.getByTestId("answer-line")).toBeVisible({ timeout: 15_000 });

  await page.goto("/trip/");
  await expect(page.getByRole("main").getByText(`Your run: Seattle → Bainbridge Island`)).toBeVisible();

  await page.getByLabel("From", { exact: true }).selectOption({ label: "Seattle" });
  await page.getByLabel("To", { exact: true }).selectOption({ label: "Bainbridge Island" });
  await page.getByRole("button", { name: "Next sailings" }).click();
  await expect(page).toHaveURL(new RegExp(`/trip/${SLUG}/?`));
});
