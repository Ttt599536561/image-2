// ★server-only：后台用户管理（09 §10.3）。搜索/详情/封禁/并发在此（可测）；改密+会话吊销走 Better Auth（在路由，需 admin 会话头）；
// 调积分走 ③ adjustCredit（绝不重写钱逻辑）。封禁以业务 users.is_banned 为权威（requireUserStrict 每请求查它）。
import { getSql } from "../../db/db.server";
import { writeAuditHttp } from "./audit.server";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  balanceMp: number;
  maxConcurrency: number;
  isBanned: boolean;
  hasPaid: boolean;
  createdAt: string;
}

/** 搜索（邮箱 ILIKE 包含；分页，09 §10.3）。 */
export async function searchUsers(
  q: string | undefined,
  page = 1,
  pageSize = 50,
): Promise<{ items: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  const sql = getSql();
  const offset = (page - 1) * pageSize;
  const needle = q?.trim() ? `%${q.trim()}%` : null;
  const rows = (await sql`
    SELECT u.id, u.email, u.role, u.max_concurrency, u.is_banned, u.has_paid, u.created_at,
           COALESCE(a.balance_mp,0) AS balance_mp
    FROM users u LEFT JOIN credit_accounts a ON a.user_id = u.id
    WHERE (${needle}::text IS NULL OR u.email ILIKE ${needle})
    ORDER BY u.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n FROM users u
    WHERE (${needle}::text IS NULL OR u.email ILIKE ${needle})`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as string,
      balanceMp: num(r.balance_mp),
      maxConcurrency: num(r.max_concurrency),
      isBanned: r.is_banned === true,
      hasPaid: r.has_paid === true,
      createdAt: iso(r.created_at),
    })),
    total: num(c?.n),
    page,
    pageSize,
  };
}

export interface AdminUserDetail {
  user: AdminUserRow & { updatedAt: string };
  lots: { source: string; grantedMp: number; remainingMp: number; expiresAt: string | null; createdAt: string }[];
  ledger: {
    entryType: string;
    amountMp: number;
    balanceAfterMp: number;
    reason: string | null;
    refType: string | null;
    refId: string | null;
    createdAt: string;
  }[];
  stats: { conversations: number; images: number; inflight: number };
}

/** 用户详情（聚合余额/批次/流水/统计，09 §10.3）。owner = 任意（admin 跨用户，但只读 + 审计另算）。 */
export async function getUserDetail(userId: string): Promise<AdminUserDetail> {
  const sql = getSql();
  const [u] = (await sql`
    SELECT u.id, u.email, u.role, u.max_concurrency, u.is_banned, u.has_paid, u.created_at, u.updated_at,
           COALESCE(a.balance_mp,0) AS balance_mp
    FROM users u LEFT JOIN credit_accounts a ON a.user_id = u.id
    WHERE u.id = ${userId} LIMIT 1`) as Row[];
  if (!u) throw new Response("用户不存在", { status: 404 });
  const lots = (await sql`
    SELECT source, granted_mp, remaining_mp, expires_at, created_at FROM credit_lots
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 100`) as Row[];
  const ledger = (await sql`
    SELECT entry_type, amount_mp, balance_after_mp, reason, ref_type, ref_id, created_at
    FROM credit_ledger WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`) as Row[];
  const [conv] = (await sql`SELECT COUNT(*)::int AS n FROM conversations WHERE user_id = ${userId}`) as Row[];
  const [img] = (await sql`SELECT COUNT(*)::int AS n FROM images WHERE user_id = ${userId}`) as Row[];
  const [inf] = (await sql`
    SELECT COUNT(*)::int AS n FROM generations
    WHERE user_id = ${userId} AND status IN ('queued','claimed','running')`) as Row[];
  return {
    user: {
      id: u.id as string,
      email: u.email as string,
      role: u.role as string,
      balanceMp: num(u.balance_mp),
      maxConcurrency: num(u.max_concurrency),
      isBanned: u.is_banned === true,
      hasPaid: u.has_paid === true,
      createdAt: iso(u.created_at),
      updatedAt: iso(u.updated_at),
    },
    lots: lots.map((l) => ({
      source: l.source as string,
      grantedMp: num(l.granted_mp),
      remainingMp: num(l.remaining_mp),
      expiresAt: isoOrNull(l.expires_at),
      createdAt: iso(l.created_at),
    })),
    ledger: ledger.map((g) => ({
      entryType: g.entry_type as string,
      amountMp: num(g.amount_mp),
      balanceAfterMp: num(g.balance_after_mp),
      reason: (g.reason as string | null) ?? null,
      refType: (g.ref_type as string | null) ?? null,
      refId: (g.ref_id as string | null) ?? null,
      createdAt: iso(g.created_at),
    })),
    stats: { conversations: num(conv?.n), images: num(img?.n), inflight: num(inf?.n) },
  };
}

/** 封禁/解封：业务 users.is_banned 为权威（requireUserStrict 每请求查它）+ 审计。会话吊销由路由层 Better Auth 补做。 */
export async function setBanned(args: {
  adminId: string;
  userId: string;
  banned: boolean;
  reason?: string | null;
  ip?: string | null;
}): Promise<void> {
  const sql = getSql();
  const rows = (await sql`SELECT is_banned FROM users WHERE id = ${args.userId} LIMIT 1`) as Row[];
  if (rows.length === 0) throw new Response("用户不存在", { status: 404 });
  const before = rows[0].is_banned === true;
  await sql`UPDATE users SET is_banned = ${args.banned}, updated_at = now() WHERE id = ${args.userId}`;
  await writeAuditHttp({
    adminId: args.adminId,
    action: args.banned ? "ban" : "unban",
    targetType: "user",
    targetId: args.userId,
    before: { is_banned: before },
    after: { is_banned: args.banned },
    ip: args.ip ?? null,
    reason: args.reason ?? null,
  });
}

/** 调并发上限（CHECK ≥1 兜底）+ 审计。 */
export async function setConcurrency(args: {
  adminId: string;
  userId: string;
  maxConcurrency: number;
  ip?: string | null;
}): Promise<void> {
  const sql = getSql();
  const rows = (await sql`SELECT max_concurrency FROM users WHERE id = ${args.userId} LIMIT 1`) as Row[];
  if (rows.length === 0) throw new Response("用户不存在", { status: 404 });
  const before = num(rows[0].max_concurrency);
  await sql`UPDATE users SET max_concurrency = ${args.maxConcurrency}, updated_at = now() WHERE id = ${args.userId}`;
  await writeAuditHttp({
    adminId: args.adminId,
    action: "set_concurrency",
    targetType: "user",
    targetId: args.userId,
    before: { max_concurrency: before },
    after: { max_concurrency: args.maxConcurrency },
    ip: args.ip ?? null,
  });
}
