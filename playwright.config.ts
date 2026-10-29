import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

/** The browser test runs the app on the local chain (LiteSVM, in-memory DB): no devnet, no model calls. */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  globalTimeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: false, // each run sells the demo tote, so it needs a fresh chain
    env: {
      NEXT_DIST_DIR: ".next-e2e", VCX_LOCAL_CHAIN: "1", AGENT_PROVIDER: "scripted", DEMO_COPIER: "1",
      MERCHANT_DEMO: "1", APP_URL: `http://localhost:${PORT}`,
    },
  },
});
