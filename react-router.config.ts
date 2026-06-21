import type { Config } from "@react-router/dev/config";

export default {
  // SSR framework mode (loader/action/server rendering). 阶段一用 mock 数据，
  // loader 返静态种子；阶段二同结构换真后台（Neon/Better Auth/R2）。
  ssr: true,
  appDirectory: "app",
} satisfies Config;
