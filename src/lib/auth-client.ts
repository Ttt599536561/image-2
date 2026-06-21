// Better Auth 浏览器客户端（05 §6.1）。默认 basePath=/api/auth，对应 catch-all 资源路由（api.auth.$.ts）。
// 同源 cookie 会话（HttpOnly）；signUp.email/signIn.email/signOut/changePassword 均经此。
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
