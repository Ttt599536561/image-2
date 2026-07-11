// ★server-only：Better Auth 单实例（05 §6.1）。email+password（不验邮箱）+ admin 插件 + bcryptjs。
// 🔴 红线：generateId 'uuid'（字面量，native uuid 列与业务 users.id 同型）；bcrypt 72 字节断言在 password.hash 内；
//    secret/URL 只在服务端（构建期断言不进 bundle，00 §1.4）。不启用 multi-session 插件（少一个攻击面）。
import { neonConfig } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import ws from "ws";
import { onSessionCreated, onUserRegistered } from "./auth-hooks";
import { createAuthPool } from "./auth-pool";

if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

// Better Auth 自管 user/session/account/verification —— 直连 Neon（与业务库同库，05 §6.2）。
const pool = createAuthPool();

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // 规格 §4：不验邮箱
    minPasswordLength: 6,
    maxPasswordLength: 72, // 粗过滤（按字符）；字节防线在 password.hash
    autoSignIn: true, // §24-1：注册成功自动登录
    password: {
      // 字节限长唯一兜底点（注册与 admin setUserPassword 都必经）。bcrypt 静默截断 >72 字节 = 越权风险。
      hash: async (pw) => {
        if (new TextEncoder().encode(pw).length > 72) {
          throw new APIError("BAD_REQUEST", { message: "密码过长（最多 72 字节）" });
        }
        return bcrypt.hash(pw, 10);
      },
      verify: ({ password, hash }) => bcrypt.compare(password, hash),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 滚动续期
    cookieCache: { enabled: true, maxAge: 5 * 60 }, // 300s 缓存——敏感路径不吃它（05 §6.3）
  },
  advanced: {
    // 字面量 'uuid'：让 user.id 列为 Postgres 原生 uuid，与业务 users.id 同型（05 §6.2）。
    database: { generateId: "uuid" },
  },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  databaseHooks: {
    user: { create: { after: onUserRegistered } }, // 注册原子发放
    session: { create: { after: onSessionCreated } }, // 孤儿兜底：每次登录缺则补发
  },
});
