// Playwright 冒烟配置（⑦ · 真相源 10 §11.10）。关键路径 @smoke：注册 → 生图 → 兑换。
// 选跑（CI 单独 job）。运行器是 @playwright/test（非 vitest），且本文件/ tests/e2e 不在 tsconfig include 内，故不入 tsc/默认单测。
//
// 安装（首次）：npm i -D @playwright/test && npx playwright install chromium
// 跑：npm run test:e2e。受保护 runner 加载 .env.test，Playwright 自动启动 dev:ui:test。
// 真中转场景默认跳过，只能在显式批准的 disposable 环境启用。
import { defineConfig, devices } from "@playwright/test";
import { assertLoopbackTestUrl } from "./scripts/test-env-guard";

const baseURL = assertLoopbackTestUrl(process.env.E2E_BASE_URL || "http://localhost:8888");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  webServer: {
    command: "npm run dev:ui:test",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
