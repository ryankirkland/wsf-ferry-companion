import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Reliability + capacity against the static export, with the stats
// documents route-intercepted the same way trip.spec handles the schedule.
// These assert the HONESTY behaviour rather than the numbers: a degraded
// slot must say it degraded, a terminal that publishes nothing must say
// that too, and the sailing highlighted must be the rider's own.

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

const json = (body: unknown) => ({
  body: JSON.stringify(body),
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
});

const block = (n: number, pct: number | null, p50 = 3, p90 = 25) => ({
  n,
  ontime_pct: pct,
  p50,
  p90,
});

/** Slots keyed to the pair-day template's own offsets, so "your sailing"
 *  lines up with the next departure exactly as it does in production. */
function buildPairStats(baseMs: number) {
  const at = (offsetMin: number) => HHMM.format(new Date(baseMs + offsetMin * MIN));
  return {
    v: 1,
    generated_at: new Date(baseMs).toISOString(),
    data_through: "2026-07-30",
    window: { label: "last 90 days", from: "2026-05-02", to: "2026-07-30" },
    pair: {
      dep: DEP,
      arr: ARR,
      dep_name: "Seattle",
      arr_name: "Bainbridge Island",
      slug: SLUG,
    },
    ontime_definition_min: 10,
    min_slot_sample: 30,
    overall: { primary: block(1929, 73), all_time: block(192489, 88) },
    slots: [
      // The next boat (+6): healthy, so the highlighted card is the common case.
      { hhmm: at(6), basis: "slot", primary: block(63, 78), slot_window: block(63, 78), all_time: block(5497, 85) },
      // The one after (+18): too thin, degraded to its hour.
      { hhmm: at(18), basis: "hour", primary: block(310, 81), slot_window: block(4, 25), all_time: block(2426, 79) },
      { hhmm: at(55), basis: "slot", primary: block(62, 100, 1, 2), slot_window: block(62, 100), all_time: block(5796, 99) },
      { hhmm: at(130), basis: "slot", primary: block(90, 97), slot_window: block(90, 97), all_time: block(8387, 98) },
      { hhmm: at(210), basis: "hour", primary: block(86, 63), slot_window: block(25, 40), all_time: block(2187, 83) },
      { hhmm: at(-8), basis: "slot", primary: block(61, 92), slot_window: block(61, 92), all_time: block(5100, 94) },
      { hhmm: at(-40), basis: "slot", primary: block(58, 88), slot_window: block(58, 88), all_time: block(4900, 90) },
    ],
    seasons: [
      { season: "winter", n: 46850, ontime_pct: 93.8, p90: 7.2 },
      { season: "summer", n: 48698, ontime_pct: 79.2, p90: 18.1 },
    ],
    cancellations: {
      tracking_since: "2026-07-29",
      window: { from: "2026-07-29", to: "2026-07-29" },
      note: "Sailings pulled from the schedule in advance are not counted - treat this as a floor.",
      scheduled: 22,
      not_sailed: 2,
      days: 1,
      unreconciled_days: 0,
      rate_pct: 9.09,
    },
  };
}

/** Offsets match the pair-day template's own sailings (+6, +18, +130), because
 *  drive-up space now renders ON the departure card and the join is depart_ms:
 *  a fixture that drifts from the schedule would silently show nothing. */
function buildCapacity(baseMs: number) {
  const sailing = (offsetMin: number, drive_up: number, level: string) => ({
    depart_ms: baseMs + offsetMin * MIN,
    vessel: "Tacoma",
    cancelled: false,
    drive_up,
    level,
    max_space: 120,
    reservable: null,
  });
  return {
    v: 1,
    generated_at: new Date(baseMs).toISOString(),
    // Southworth (20) deliberately absent: the non-reporting branch.
    reporting_terminals: [3, 7],
    pairs: {
      [`${DEP}-${ARR}`]: [
        sailing(6, 90, "plenty"),
        sailing(18, 24, "filling"),
        // The +55 sailing is struck as a tidal cancellation by the schedule:
        // its card must not carry a space count as well.
        sailing(55, 40, "plenty"),
        sailing(130, 3, "full"),
      ],
    },
  };
}

const SUMMARY = {
  v: 1,
  generated_at: "2026-07-31T07:00:00Z",
  data_through: "2026-07-30",
  window: { label: "last 90 days", from: "2026-05-02", to: "2026-07-30" },
  ontime_definition_min: 10,
  coverage: {
    since: "2002-03-01",
    through: "2026-07-30",
    sailings: 3493725,
    vessels: 30,
    pairs_published: 38,
    note: "Every departure the fleet reported since 2002-03-01.",
    thin_days: [],
    thin_days_note: "Days below half the recent median.",
  },
  system: { primary: block(38177, 79, 2.8, 17.8), all_time: block(3493725, 90.1, 2, 9.9) },
  by_year: Array.from({ length: 25 }, (_, i) => ({
    year: 2002 + i,
    n: 140000,
    ontime_pct: 92 - i * 0.4,
    p90: 9,
  })),
  by_month: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    n: 280000,
    ontime_pct: 90 - i,
    p90: 8,
  })),
  superlatives: {
    most_punctual_vessel: { vessel_name: "Walla Walla", ontime_pct: 94.6, n: 705 },
    roughest_month: { month: 7, ontime_pct: 81.2, n: 312127 },
    most_punctual_pair: {
      dep: 17,
      arr: 11,
      name: "Port Townsend to Coupeville",
      slug: "port-townsend-coupeville",
      ontime_pct: 93.5,
      n: 1217,
    },
    toughest_pair: {
      dep: 15,
      arr: 1,
      name: "Orcas Island to Anacortes",
      slug: "orcas-island-anacortes",
      ontime_pct: 30.3,
      n: 175,
    },
  },
  vessels: [
    { vessel_name: "Walla Walla", primary: block(900, 96), all_time: block(50000, 88) },
    { vessel_name: "Tacoma", primary: block(800, 71), all_time: block(50000, 85) },
  ],
  cancellations: {
    tracking_since: "2026-07-29",
    window: { from: "2026-07-29", to: "2026-07-29" },
    note: "Treat this as a floor.",
    scheduled: 526,
    not_sailed: 18,
    pair_days: 38,
    unreconciled_days: 0,
    rate_pct: 3.42,
  },
};

async function interceptStats(page: Page, baseMs: number) {
  // Playwright matches the LAST registered route first, so the catch-all
  // goes down before the specific pair or it would shadow it.
  await page.route("**/data/stats/pairs/*.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route(`**/data/stats/pairs/${DEP}-${ARR}.json`, (r) =>
    r.fulfill(json(buildPairStats(baseMs))),
  );
  await page.route("**/data/stats/summary.json", (r) => r.fulfill(json(SUMMARY)));
  await page.route("**/data/capacity.json", (r) => r.fulfill(json(buildCapacity(baseMs))));
}

/** The schedule side, trimmed from trip.spec: enough for a next boat. */
async function interceptSchedule(page: Page, baseMs: number) {
  const raw = fixture("pair-day.template.json")
    .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(baseMs + Number(n) * MIN))
    .replace(/%%ISO(-?\d+)%%/g, (_, n) => new Date(baseMs + Number(n) * MIN).toISOString())
    .replace(
      /%%TODAY%%/g,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(baseMs)),
    )
    .replace(/%%NOW%%/g, new Date(baseMs).toISOString());
  const day = JSON.parse(raw) as { sailings: { depart_ms: number }[]; adjustments: unknown[] };
  // Strike the +55 min sailing, exactly as trip.spec does: a cancelled card
  // must not also carry a drive-up count.
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
  await page.route("**/data/pairs/index.json", (r) =>
    r.fulfill({ body: fixture("pairs-index.json"), contentType: "application/json" }),
  );
  await page.route("**/data/pairs/*/*.json", (r) => r.fulfill(json(day)));
  await page.route("**/data/fares/*.json", (r) =>
    r.fulfill({ body: fixture("fares-14-5.json"), contentType: "application/json" }),
  );
  await page.route("**/data/alerts.json", (r) =>
    r.fulfill(json({ v: 1, generated_at: new Date(baseMs).toISOString(), watermark: "1:0", alerts: [] })),
  );
  await page.route("**/data/fleet.json", (r) =>
    r.fulfill(json({ v: 1, generated_at: new Date(baseMs).toISOString(), vessels: [] })),
  );
  await page.route("**/data/vessels.json", (r) => r.fulfill(json({ v: 1, vessels: [] })));
}

test.describe("pair reliability", () => {
  test.beforeEach(async ({ page }) => {
    const baseMs = Date.now();
    await interceptSchedule(page, baseMs);
    await interceptStats(page, baseMs);
    await page.goto(`/trip/${SLUG}/`);
  });

  test("headline states the window and the sample behind it", async ({ page }) => {
    const section = page.getByTestId("reliability");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("reliability-headline")).toHaveText(/^\d+%$/);
    await expect(section).toContainText("1,929 sailings");
    await expect(section).toContainText("last 90 days");
    await expect(section).toContainText("within 10 minutes of schedule");
  });

  test("the rider's own sailing is called out and highlighted in the table", async ({ page }) => {
    const your = page.getByTestId("your-sailing");
    await expect(your).toBeVisible();
    const time = (await your.innerText()).match(/(\d{1,2}:\d{2}\s?[AP]M)/)?.[1];
    expect(time).toBeTruthy();
    // The same clock time appears in the departure list as the next boat.
    await expect(page.getByTestId("answer-line")).toContainText(time!);
    await expect(page.getByTestId("slot-row").filter({ hasText: time! })).toHaveCount(1);
  });

  test("a thin slot shows the hour instead and explains the marker", async ({ page }) => {
    await expect(page.locator('[data-testid="slot-row"][data-basis="hour"]').first()).toBeVisible();
    const legend = page.getByTestId("hour-legend");
    await expect(legend).toContainText("fewer than 30 departures");
    await expect(legend).toContainText("surrounding hour");
  });

  test("cancellation copy carries its floor caveat and its tracking start", async ({ page }) => {
    const cancellations = page.getByTestId("cancellations");
    await expect(cancellations).toContainText("2026-07-29");
    await expect(cancellations).toContainText("floor");
    // One day of tracking is too little for a rate, and it says so.
    await expect(cancellations).toContainText("too early for a meaningful rate");
  });

  test("expanding reveals the rest of the sailings", async ({ page }) => {
    // Anchor on the toggle first: it renders with the slot rows, so the
    // "before" count is taken from a settled list, and the "after" count
    // polls rather than racing the expansion re-render.
    const showAll = page.getByRole("button", { name: /Show all \d+ sailings/ });
    await expect(showAll).toBeVisible();
    const before = await page.getByTestId("slot-row").count();
    await showAll.click();
    await expect.poll(() => page.getByTestId("slot-row").count()).toBeGreaterThan(before);
  });
});

test.describe("drive-up capacity", () => {
  test("space rides on the departure card it describes, in WSF's own wording", async ({ page }) => {
    const baseMs = Date.now();
    await interceptSchedule(page, baseMs);
    await interceptStats(page, baseMs);
    await page.goto(`/trip/${SLUG}/`);

    // No separate section: the reading sits inside the sailing's own row,
    // joined on depart_ms (owner's call, 2026-08-30). Visible rows run from
    // the next boat on: +6, +18, +55 (cancelled), +130, +210.
    const rows = page.getByTestId("departures").locator("li");
    await expect(rows.nth(0).getByTestId("drive-up")).toContainText("90 drive-up spaces");
    await expect(rows.nth(1).getByTestId("drive-up")).toContainText(
      "24 drive-up spaces · filling up",
    );
    await expect(rows.nth(3).getByTestId("drive-up")).toContainText("3 drive-up spaces");
    await expect(rows.nth(3).getByTestId("drive-up")).toHaveAttribute("data-level", "full");
    await expect(rows.nth(3).getByTestId("drive-up")).toContainText("nearly full");
    // The struck sailing says "Cancelled" and nothing about space.
    await expect(rows.nth(2)).toHaveAttribute("data-state", "cancelled");
    await expect(rows.nth(2).getByTestId("drive-up")).toHaveCount(0);

    // The meaning and the reading's age stay on the page, once.
    const note = page.getByTestId("capacity-note");
    await expect(note).toContainText("Reserved spaces are a separate pool");
    await expect(note).toContainText(/Drive-up space as of \d{1,2}:\d{2} (AM|PM)/);
  });

  test("a future date shows no space at all - the feed only knows now", async ({ page }) => {
    const baseMs = Date.now();
    await interceptSchedule(page, baseMs);
    await interceptStats(page, baseMs);
    await page.goto(`/trip/${SLUG}/`);
    await expect(page.getByTestId("drive-up").first()).toBeVisible();

    await page.getByRole("tab", { name: "Tomorrow" }).click();
    await expect(page.getByTestId("drive-up")).toHaveCount(0);
    await expect(page.getByTestId("capacity-note")).toHaveCount(0);
  });

  test("a terminal that publishes nothing says so instead of showing an empty gauge", async ({
    page,
  }) => {
    const baseMs = Date.now();
    await interceptSchedule(page, baseMs);
    await interceptStats(page, baseMs);
    // Southworth is not in reporting_terminals.
    await page.goto("/trip/southworth-vashon-island/");

    const absent = page.getByTestId("capacity-absent");
    await expect(absent).toBeVisible();
    await expect(absent).toContainText("does not report drive-up space");
    await expect(absent).toContainText("not a sign the lot is full");
  });
});

test("an overnight-quiet feed blames the feed, not the terminal", async ({ page }) => {
  const baseMs = Date.now();
  await interceptSchedule(page, baseMs);
  await interceptStats(page, baseMs);
  // The real 01:00 PT payload: nothing reporting anywhere.
  await page.route("**/data/capacity.json", (r) =>
    r.fulfill(
      json({
        v: 1,
        generated_at: new Date(baseMs).toISOString(),
        reporting_terminals: [],
        pairs: {},
      }),
    ),
  );
  await page.goto(`/trip/${SLUG}/`);

  const quiet = page.getByTestId("capacity-quiet");
  await expect(quiet).toBeVisible();
  await expect(quiet).toContainText("not publishing drive-up space for any terminal");
  // Seattle DOES report during the day; the page must not claim otherwise.
  await expect(page.getByTestId("capacity-absent")).toHaveCount(0);
});

test.describe("/stats overview", () => {
  test.beforeEach(async ({ page }) => {
    await interceptStats(page, Date.now());
    await page.goto("/stats/");
  });

  test("leads with both windows and never hides the sample size", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "The on-time record" })).toBeVisible();
    await expect(page.locator("main")).toContainText("on time over the last 90 days");
    await expect(page.locator("main")).toContainText("38,177 sailings");
    await expect(page.locator("main")).toContainText("3,493,725 sailings");
  });

  test("renders the year history and the month grid", async ({ page }) => {
    // toHaveCount auto-waits; a bare count() races the client stats fetch
    // and lost on CI runners once the chunk layout shifted load timing.
    const bars = page.getByTestId("year-chart").locator("> div");
    await expect(bars).toHaveCount(25);
    await expect(page.getByTestId("month-grid")).toBeVisible();
  });

  test("vessel names read as riders know them, not as the feed reports them", async ({ page }) => {
    const vessels = page.getByTestId("vessel-list");
    await expect(vessels).toContainText("Walla Walla");
    await expect(vessels).not.toContainText("WallaWalla");
  });

  test("superlative cards link through to the pair page", async ({ page }) => {
    await page.getByRole("link", { name: /Port Townsend to Coupeville/ }).click();
    await expect(page).toHaveURL(/port-townsend-coupeville/);
  });
});
