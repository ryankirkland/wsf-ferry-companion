// Visual-review tour: screenshots of the built export with the same
// route fulfillment the e2e specs use (fixtures, deterministic clock
// offsets). Run from web/ with the export served on :4321:
//
//   npx serve out -l 4321 &
//   node scripts/screenshot-tour.mjs
//
// Shots land in SHOT_DIR (default test-results/shots, gitignored). This
// lives in the repo ON PURPOSE: an earlier scratchpad-only copy had to
// be copied next to node_modules per run and cleaned up after, and a
// relative-path cleanup in a failed command chain deleted the master
// copy twice. A committed tool runs in place - no copies, no cleanup.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const OUT = process.env.SHOT_DIR ?? path.resolve("test-results/shots");
mkdirSync(OUT, { recursive: true });
const fx = (n) => readFileSync(path.resolve("public/dev-fixtures", n), "utf8");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const weather = fx("weather.template.json")
  .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(Date.now() + Number(n) * 60000))
  .replace(/%%TODAY%%/g, today)
  .replace(/%%NOW%%/g, new Date().toISOString());

const MIN = 60000;
const day = fx("pair-day.template.json")
  .replace(/"%%MS(-?\d+)%%"/g, (_, n) => String(Date.now() + Number(n) * MIN))
  .replace(/%%ISO(-?\d+)%%/g, (_, n) => new Date(Date.now() + Number(n) * MIN).toISOString())
  .replace(/%%TODAY%%/g, today)
  .replace(/%%NOW%%/g, new Date().toISOString());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
const json = (body) => ({ body, contentType: "application/json" });
await page.route("**/data/weather.json", (r) => r.fulfill(json(weather)));
await page.route("**/data/pairs/index.json", (r) => r.fulfill(json(fx("pairs-index.json"))));
await page.route("**/data/pairs/7-3/**", (r) => {
  const d = JSON.parse(day);
  d.pair = { dep: 7, arr: 3 };
  return r.fulfill(json(JSON.stringify(d)));
});
await page.route("**/data/fares/**", (r) => r.fulfill(json(fx("fares-14-5.json"))));
await page.route("**/data/alerts.json", (r) => r.fulfill(json(fx("alerts.json"))));
await page.route("**/data/stats/**", (r) => r.fulfill({ status: 404, body: "" }));
await page.route("**/data/capacity.json", (r) => r.fulfill({ status: 404, body: "" }));
const fleet = JSON.parse(fx("fleet-frame-0.json"));
fleet.generated_at = new Date().toISOString();
await page.route("**/data/fleet.json", (r) => r.fulfill(json(JSON.stringify(fleet))));
await page.route("**/data/vessels.json", (r) => r.fulfill(json(fx("vessels.json"))));
await page.route("**/data/terminals.json", (r) => r.fulfill(json(fx("terminals.json"))));
await page.route("**/data/adjustments.json", (r) => r.fulfill({ status: 404, body: "" }));

await page.goto("http://localhost:4321/trip/seattle-bainbridge-island/");
await page.waitForSelector('[data-testid="weather-strip"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/wx-trip.png` });

await page.goto("http://localhost:4321/");
await page.waitForSelector("[data-terminal] .wx", { timeout: 25000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/wx-map.png` });

// Hover tip on the nearest hoverable boat.
const v = await page.evaluate(() => {
  const cs = [];
  for (const el of document.querySelectorAll("[data-vessel]")) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 40 || cy < 130 || cx > innerWidth - 40 || cy > innerHeight - 170) continue;
    cs.push({ id: el.dataset.vessel, cx, cy, d: Math.hypot(cx - innerWidth / 2, cy - innerHeight / 2) });
  }
  cs.sort((a, b) => a.d - b.d);
  for (const c of cs) {
    const el = document.querySelector(`[data-vessel="${c.id}"]`);
    const hit = document.elementFromPoint(c.cx, c.cy);
    if (el && hit && el.contains(hit)) return c;
  }
  return null;
});
if (v) {
  await page.mouse.move(v.cx, v.cy);
  await page.waitForTimeout(500);
  await page.mouse.move(v.cx, v.cy);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/wx-hover.png` });
  await page.mouse.move(20, 400);
}

// Full zoom-out: trusted keyboard "-" until the minZoom floor (focus
// click on empty land so it can't open a vessel card).
await page.mouse.click(980, 180);
for (let i = 0; i < 8; i++) { await page.keyboard.press("-"); await page.waitForTimeout(250); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/wx-zoomout.png` });

// Zoomed into the triangle: labels should re-center, chips return.
for (let i = 0; i < 3; i++) { await page.mouse.dblclick(595, 485); await page.waitForTimeout(900); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/wx-zoomin.png` });

// Phone default framing - the view that hid the triangle's chips.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:4321/");
await page.waitForSelector("[data-terminal] .wx", { timeout: 25000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/wx-phone.png` });
await browser.close();
console.log("shots written");
