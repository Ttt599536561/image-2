import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
// RR8 Node framework build. Vitest uses its own config and does not load this plugin.
export default defineConfig({
  server: { host: true },
  plugins: [reactRouter()],
});
