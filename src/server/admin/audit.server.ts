// ★server-only：审计留痕（09 §10.6）。钱/码类操作同事务写 writeAudit；跨连接操作（ban/改密走 Better Auth）
// 用 writeAuditHttp 在状态变更后补写（05 §6.5「先变更后审计 + 审计失败补偿重试」）。
// 🔴 红线：audit_log 只追加、无删改端点（管理员不可改自己记录）；改密类 before/after 绝不落明文（只标 {changed:true}）。
import { getSql } from "../../db/db.server";
import type { TxClient } from "../tx.server";

export interface AuditEntry {
  adminId: string;
  action: string; // adjust_credit|reset_pw|ban|unban|set_concurrency|gen_codes|disable_batch|edit_config|create_package|edit_package|delete_package|create_inspiration|edit_inspiration|delete_inspiration|reorder_inspiration
  targetType?: string | null; // user|code|package|inspiration|config
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  reason?: string | null;
}

const J = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** 同事务写审计（钱/码事务内，与流水一起 COMMIT/ROLLBACK）。 */
export async function writeAudit(c: TxClient, e: AuditEntry): Promise<void> {
  await c.query(
    `INSERT INTO audit_log(admin_id,action,target_type,target_id,before,after,ip,reason)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [e.adminId, e.action, e.targetType ?? null, e.targetId ?? null, J(e.before), J(e.after), e.ip ?? null, e.reason ?? null],
  );
}

/** HTTP 单语句写审计（非事务路径：ban/改密走 Better Auth 后补写；失败由调用方重试）。 */
export async function writeAuditHttp(e: AuditEntry): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO audit_log(admin_id,action,target_type,target_id,before,after,ip,reason)
    VALUES(${e.adminId}, ${e.action}, ${e.targetType ?? null}, ${e.targetId ?? null},
           ${J(e.before)}::jsonb, ${J(e.after)}::jsonb, ${e.ip ?? null}, ${e.reason ?? null})`;
}

// —— 审计列表（只读，倒序，可按 admin/action/target 筛，09 §10.6）——
export interface AuditItem {
  id: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  reason: string | null;
  createdAt: string;
}

export async function listAudit(filters: {
  action?: string;
  targetType?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AuditItem[]; total: number; page: number; pageSize: number }> {
  const sql = getSql();
  const page = filters.page ?? 1;
  const pageSize = Math.min(200, filters.pageSize ?? 50);
  const offset = (page - 1) * pageSize;
  const action = filters.action ?? null;
  const targetType = filters.targetType ?? null;
  const rows = (await sql`
    SELECT a.id, a.admin_id, u.email AS admin_email, a.action, a.target_type, a.target_id,
           a.before, a.after, a.ip, a.reason, a.created_at
    FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id
    WHERE (${action}::text IS NULL OR a.action = ${action})
      AND (${targetType}::text IS NULL OR a.target_type = ${targetType})
    ORDER BY a.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Record<string, unknown>[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n FROM audit_log a
    WHERE (${action}::text IS NULL OR a.action = ${action})
      AND (${targetType}::text IS NULL OR a.target_type = ${targetType})`) as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      adminId: r.admin_id as string,
      adminEmail: (r.admin_email as string | null) ?? null,
      action: r.action as string,
      targetType: (r.target_type as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      before: r.before ?? null,
      after: r.after ?? null,
      ip: (r.ip as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    total: Number(c?.n ?? 0),
    page,
    pageSize,
  };
}
