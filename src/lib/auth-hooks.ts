// ★server-only：Better Auth databaseHooks（05 §6.6）。注册原子发放 + 孤儿账号惰性补发。
import { getSql } from "../db/db.server";
import { grantSignup } from "../server/money/grant.server";

/** 注册成功 after-hook：原子发放 0.14（uq_grant_signup/账户闸 幂等；失败应让注册失败 → 向上抛）。 */
export async function onUserRegistered(user: { id: string; email: string }): Promise<void> {
  await grantSignup(user.id, user.email);
}

/**
 * 孤儿兜底：每次会话创建（登录）校验 credit_accounts 缺则补发（05 §6.6）。
 * email 从 Better Auth 的 "user" 表取（孤儿时业务 users 行可能尚不存在）。
 */
export async function onSessionCreated(session: { userId: string }): Promise<void> {
  const sql = getSql();
  const has = await sql`SELECT 1 FROM credit_accounts WHERE user_id=${session.userId} LIMIT 1`;
  if (has.length > 0) return;
  const u = await sql`SELECT email FROM "user" WHERE id=${session.userId} LIMIT 1`;
  await grantSignup(session.userId, (u[0]?.email as string | undefined) ?? "");
}
