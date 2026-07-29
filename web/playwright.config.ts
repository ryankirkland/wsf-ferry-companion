import { defineConfig } from "@playwright/test";

// Smoke tests run against the static export served locally, with fleet data
// route-intercepted from fixtures. Tile/glyph fetches may fail in CI - no
// assertion depends on tile pixels.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "pnpm exec serve out -l 4173 -n",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
