// ★server-only：后台生成记录列表（09 §10.5，纯记录、不做收录）。默认近 7 天/50 条/倒序；失败行直显三列。
// #12 硬删：级联 images + 清 R2，单删/批删，写审计；账本保留（对账走 credit_lots，不受影响）。
import { getSql } from "../../db/db.server";
import { deleteManyFromR2 } from "../r2.server";
import { toInt } from "../sumCodec";
import { writeAuditHttp } from "./audit.server";

type Row = Record<string, unknown>;

export interface AdminGeneration {
  id: string;
  email: string;
  prompt: string;
  size: string;
  status: string;
  errorCode: string | null;
  error: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  createdAt: string;
  thumbUrl: string | null; // 成功才有图（R2 public_url）
}

export async function listGenerations(args: {
  from?: string;
  to?: string;
  userEmail?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AdminGeneration[]; total: number; page: number; pageSize: number }> {
  const sql = getSql();
  const page = args.page ?? 1;
  const pageSize = Math.min(200, args.pageSize ?? 50);
  const offset = (page - 1) * pageSize;
  // 默认近 7 天。
  const from = args.from ? new Date(args.from).toISOString() : new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = args.to ? new Date(args.to).toISOString() : null;
  const email = args.userEmail?.trim() ? `%${args.userEmail.trim()}%` : null;
  const status = args.status?.trim() ? args.status.trim() : null;

  const rows = (await sql`
    SELECT g.id, g.prompt, g.size, g.status, g.error_code, g.error, g.http_status, g.duration_ms, g.created_at,
           u.email, i.public_url AS thumb_url
    FROM generations g
    JOIN users u ON u.id = g.user_id
    LEFT JOIN images i ON i.generation_id = g.id
    WHERE g.created_at >= ${from}::timestamptz
      AND (${to}::timestamptz IS NULL OR g.created_at < ${to}::timestamptz)
      AND (${email}::text IS NULL OR u.email ILIKE ${email})
      AND (${status}::text IS NULL OR g.status = ${status})
    ORDER BY g.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n
    FROM generations g JOIN users u ON u.id = g.user_id
    WHERE g.created_at >= ${from}::timestamptz
      AND (${to}::timestamptz IS NULL OR g.created_at < ${to}::timestamptz)
      AND (${email}::text IS NULL OR u.email ILIKE ${email})
      AND (${status}::text IS NULL OR g.status = ${status})`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      email: r.email as string,
      prompt: r.prompt as string,
      size: r.size as string,
      status: r.status as string,
      errorCode: (r.error_code as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      httpStatus: r.http_status == null ? null : toInt(r.http_status),
      durationMs: r.duration_ms == null ? null : toInt(r.duration_ms),
      createdAt: new Date(r.created_at as string).toISOString(),
      thumbUrl: (r.thumb_url as string | null) ?? null,
    })),
    total: toInt(c?.n),
    page,
    pageSize,
  };
}

/**
 * #12 后台硬删生成记录（级联 images + 清 R2）。admin 可删任意用户记录（按设计无 owner-scope）；
 * 先抓 R2 keys 再 DELETE（级联 images），最后尽力删对象（失败留孤儿由清理 cron 兜底）。
 * 账本保留（credit_ledger 只追加；对账以 credit_lots 为准，不受影响）。返回真实删除行数。
 */
export async function deleteGenerations(args: {
  adminId: string;
  ids: string[];
  ip?: string | null;
}): Promise<{ deleted: number }> {
  if (args.ids.length === 0) return { deleted: 0 };
  const sql = getSql();
  // 级联删前抓 R2 keys（images.generation_id 唯一，每条最多 1 图）。
  const keyRows = (await sql`
    SELECT storage_key FROM images WHERE generation_id = ANY(${args.ids}::uuid[])`) as Row[];
  const keys = keyRows.map((r) => r.storage_key as string).filter(Boolean);
  const rows = (await sql`
    DELETE FROM generations WHERE id = ANY(${args.ids}::uuid[]) RETURNING id`) as Row[];
  if (keys.length > 0) {
    try {
      const failed = await deleteManyFromR2(keys);
      if (failed.length > 0)
        console.error("[deleteGenerations] R2 删除部分失败（孤儿由清理 cron 兜底）", failed.length);
    } catch (e) {
      console.error("[deleteGenerations] R2 删除异常（DB 行已删，孤儿由清理 cron 兜底）", e);
    }
  }
  await writeAuditHttp({
    adminId: args.adminId,
    action: args.ids.length > 1 ? "delete_generations_batch" : "delete_generation",
    targetType: "generation",
    targetId: args.ids.length === 1 ? args.ids[0] : null,
    after: { requested: args.ids.length, deleted: rows.length, images: keys.length },
    ip: args.ip ?? null,
  });
  return { deleted: rows.length };
}
