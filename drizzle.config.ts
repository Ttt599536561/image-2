import { defineConfig } from "drizzle-kit";

// drizzle-kit 配置（02 §3.5）。`generate` 离线工作（按 schema diff 出 SQL，无需 DB 连接）；
// `migrate`/`push` 接真库时用 DATABASE_URL_UNPOOLED（direct endpoint，跑 DDL）。
// 🔴 生成迁移后人工核对 drizzle/*.sql 里 5 个部分唯一索引确有 WHERE 谓词（02 §3.4，钱的命门）。
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
