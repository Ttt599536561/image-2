// Anonymous Studio E2E: real disposable PostgreSQL + local media + stubbed relay.
// The protected runner loads .env.test. No test calls a paid upstream service.
import { defineConfig, devices } from "@playwright/test";
import { assertLoopbackTestUrl } from "./scripts/test-env-guard";

const baseURL = assertLoopbackTestUrl(process.env.E2E_BASE_URL || process.env.BETTER_AUTH_URL || "http://localhost:8888");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: ".cache/playwright-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  webServer: {
    command: "npm run dev:ui:test",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
