// 钱链路真库测试专用配置（10 §11.10）。node 环境 + 从 .env 注入 Neon 串（DATABASE_URL_UNPOOLED 跑 FOR UPDATE）。
// 跑：`npm run test:money`（= node --env-file=.env … vitest run -c vitest.money.config.ts）。
// 不挂 @vitejs/plugin-react / jsdom；fileParallelism=false 限并发，避免撞 Neon max_connections。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/money/**/*.test.ts"],
    setupFiles: ["./tests/money/_setup.ts"],
    // 每个钱事务用独立 Pool（开-用-关），真并发用例靠 Promise.all 起多连接；限文件级并发护住连接数。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
