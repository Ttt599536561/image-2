import netlifyReactRouter from "@netlify/vite-plugin-react-router";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// RR8 framework 模式 + Netlify 适配（产出 Netlify Serverless Functions(Node)）。
// 注意：vitest 用独立的 vitest.config.ts（只挂 @vitejs/plugin-react），不加载 reactRouter()，
// 避免「RR 插件 + vitest」同时加载冲突（见 docs/dev 08 §9.1 / inventory 风险 #2）。
// v1 的 imageProxyPlugin dev 中间件已移除：阶段一生成走客户端 mock，不需要它；
// 阶段二真生成走 netlify/functions/generate*（独立 Functions），不靠 vite 中间件。
export default defineConfig({
  server: { host: true },
  plugins: [reactRouter(), netlifyReactRouter()],
});
