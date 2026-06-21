import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    // 钱链路真库测试（tests/money）走独立 node-env 配置（vitest.money.config.ts，需 .env Neon 串），
    // 与前端 jsdom 单测隔离，绝不在默认 `vitest run` 里跑（无 DB env 会失败）。
    exclude: [...configDefaults.exclude, 'tests/money/**'],
  },
});
