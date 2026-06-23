// ★server-only：灵感投稿审核（后台，§13.1）。通过→建 inspirations 上架卡 + 署名 + 通知；驳回→记原因 + 通知。
// 非钱链路，但内容运营仍写 audit；一经审核即终态（FOR UPDATE 锁 + status=pending 校验，防并发/重复审核）。
import { httpError } from "../../contracts/error";
import { getSql } from "../../db/db.server";
import { publicHandleFromEmail } from "../../lib/publicHandle";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string | number | Date).toISOString();
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface AdminSubmissionRow {
  id: string;
  image: string; // image_url（副本公有 URL）
  submitterId: string;
  submitterEmail: string | null;
  title: string;
  prompt: string;
  category: string | null;
  summary: string | null;
  width: number | null;
  height: number | null;
  status: "pending" | "approved" | "rejected";
  reviewReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** 待审计数（导航红点）。 */
export async function countPendingSubmissions(): Promise<number> {
  const sql = getSql();
  const [r] = (await sql`
    SELECT COUNT(*)::int AS n FROM inspiration_submissions WHERE status = 'pending'`) as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}

/** 投稿队列（按状态筛 + 分页）。status 缺省/'all' = 全部。 */
export async function listSubmissions(filters: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AdminSubmissionRow[]; total: number; page: number; pageSize: number; pending: number }> {
  const sql = getSql();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, filters.pageSize ?? 50);
  const offset = (page - 1) * pageSize;
  const status = filters.status && filters.status !== "all" ? filters.status : null;
  const rows = (await sql`
    SELECT s.id, s.image_url, s.title, s.prompt, s.category, s.summary, s.width, s.height,
           s.status, s.review_reason, s.created_at, s.reviewed_at, s.user_id, u.email AS submitter_email
    FROM inspiration_submissions s LEFT JOIN users u ON u.id = s.user_id
    WHERE (${status}::text IS NULL OR s.status = ${status})
    ORDER BY s.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n FROM inspiration_submissions
    WHERE (${status}::text IS NULL OR status = ${status})`) as Array<{ n: number }>;
  const pending = await countPendingSubmissions();
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      image: r.image_url as string,
      submitterId: r.user_id as string,
      submitterEmail: (r.submitter_email as string | null) ?? null,
      title: r.title as string,
      prompt: r.prompt as string,
      category: (r.category as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      width: numOrNull(r.width),
      height: numOrNull(r.height),
      status: r.status as AdminSubmissionRow["status"],
      reviewReason: (r.review_reason as string | null) ?? null,
      createdAt: iso(r.created_at),
      reviewedAt: isoOrNull(r.reviewed_at),
    })),
    total: Number(c?.n ?? 0),
    page,
    pageSize,
    pending,
  };
}

export interface ApproveFields {
  title: string;
  prompt: string;
  category?: string | null;
  summary?: string | null;
  active?: boolean;
}

/** 通过：建 inspirations 上架卡（cover 复用投稿副本对象、带署名）+ 投稿置 approved + 通知投稿人。 */
export async function approveSubmission(args: {
  adminId: string;
  id: string;
  fields: ApproveFields;
  ip?: string | null;
}): Promise<{ inspirationId: string }> {
  const f = args.fields;
  return tx(async (c: TxClient) => {
    const sub = (await c.query("SELECT * FROM inspiration_submissions WHERE id=$1 FOR UPDATE", [args.id]))
      .rows[0] as Row | undefined;
    if (!sub) throw httpError(404, "NOT_FOUND", "投稿不存在");
    if (sub.status !== "pending") throw httpError(400, "INVALID_PARAM", "该投稿已审核过（请刷新）");

    const u = (await c.query("SELECT email FROM users WHERE id=$1", [sub.user_id])).rows[0] as
      | { email?: string }
      | undefined;
    const handle = publicHandleFromEmail(u?.email ?? "");

    // cover_key = 投稿副本 key（以 inspirations/ 开头 → 受孤儿 known-set 保护；与 deriveCoverKey 等价）。
    const ins = await c.query(
      `INSERT INTO inspirations
         (title,cover_url,cover_key,category,prompt,summary,width,height,sort,active,submitted_by,submitter_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        f.title,
        sub.image_url,
        sub.image_key,
        f.category ?? null,
        f.prompt,
        f.summary ?? null,
        sub.width ?? null,
        sub.height ?? null,
        0,
        f.active ?? true,
        sub.user_id,
        handle,
      ],
    );
    const inspirationId = ins.rows[0].id as string;

    await c.query(
      `UPDATE inspiration_submissions
       SET status='approved', reviewed_by=$1, reviewed_at=now(), published_inspiration_id=$2, updated_at=now()
       WHERE id=$3`,
      [args.adminId, inspirationId, args.id],
    );
    await writeAudit(c, {
      adminId: args.adminId,
      action: "approve_inspiration_submission",
      targetType: "inspiration_submission",
      targetId: args.id,
      before: { status: "pending" },
      after: { inspirationId, title: f.title },
      ip: args.ip ?? null,
    });
    await c.query(
      `INSERT INTO notifications(user_id, type, payload, dedupe_key)
       VALUES($1, 'inspiration_reviewed', $2::jsonb, $3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        sub.user_id,
        JSON.stringify({ status: "approved", title: f.title, inspirationId }),
        `inspiration_reviewed:${args.id}`,
      ],
    );
    return { inspirationId };
  });
}

/** 驳回：投稿置 rejected + 记原因 + 通知（副本不再受保护，由孤儿 cron 回收）。 */
export async function rejectSubmission(args: {
  adminId: string;
  id: string;
  reason: string;
  ip?: string | null;
}): Promise<void> {
  await tx(async (c: TxClient) => {
    const sub = (await c.query("SELECT id, user_id, title, status FROM inspiration_submissions WHERE id=$1 FOR UPDATE", [
      args.id,
    ])).rows[0] as Row | undefined;
    if (!sub) throw httpError(404, "NOT_FOUND", "投稿不存在");
    if (sub.status !== "pending") throw httpError(400, "INVALID_PARAM", "该投稿已审核过（请刷新）");

    await c.query(
      `UPDATE inspiration_submissions
       SET status='rejected', review_reason=$1, reviewed_by=$2, reviewed_at=now(), updated_at=now()
       WHERE id=$3`,
      [args.reason, args.adminId, args.id],
    );
    await writeAudit(c, {
      adminId: args.adminId,
      action: "reject_inspiration_submission",
      targetType: "inspiration_submission",
      targetId: args.id,
      before: { status: "pending" },
      after: { reason: args.reason },
      ip: args.ip ?? null,
    });
    await c.query(
      `INSERT INTO notifications(user_id, type, payload, dedupe_key)
       VALUES($1, 'inspiration_reviewed', $2::jsonb, $3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        sub.user_id,
        JSON.stringify({ status: "rejected", title: sub.title, reason: args.reason }),
        `inspiration_reviewed:${args.id}`,
      ],
    );
  });
}
