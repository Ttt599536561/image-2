// ★server-only：灵感库用户投稿（用户端写 + 我的投稿读，§13.1）。非钱链路，但仍 owner-scoped + 防滥用。
// 🔴 红线：只接受 imageId；image_key/url/宽高/source 全由服务端按 images.user_id=$me 校验后从 DB 取，绝不信客户端。
//    pending 副本由孤儿 cron known-set 保护；不扣积分（与所有上传一致）。
import {
  INSPIRATION_SUBMISSION_MAX_PENDING,
  INSPIRATION_SUBMISSION_RATE_PER_WINDOW,
  type InspirationSubmitRequest,
  type MySubmissionsResponse,
} from "../contracts/inspirationSubmission";
import { httpError } from "../contracts/error";
import { getSql } from "../db/db.server";
import { copyToInspirationSubmission } from "./r2.server";
import { type TxClient, tx } from "./tx.server";

type Row = Record<string, unknown>;
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();

export interface SubmitDeps {
  // 测试可注入桩，免烧 Supabase（默认走真实 GetObject→PutObject 复制）。
  copy?: (srcKey: string, userId: string) => Promise<{ storageKey: string; publicUrl: string }>;
}

/** 提交投稿（从「我的作品」选一张图）。返回 {id, status:'pending'}。 */
export async function submitInspiration(
  userId: string,
  input: InspirationSubmitRequest,
  deps: SubmitDeps = {},
): Promise<{ id: string; status: "pending" }> {
  const sql = getSql();

  // ① 轻量限流（events 计数，interval 内联常量）。
  const [rate] = (await sql`
    SELECT COUNT(*)::int AS n FROM events
    WHERE type = 'inspiration_submit' AND user_id = ${userId}
      AND created_at > now() - interval '10 minutes'`) as Array<{ n: number }>;
  if (Number(rate?.n ?? 0) >= INSPIRATION_SUBMISSION_RATE_PER_WINDOW) {
    throw httpError(429, "RATE_LIMITED", "投稿太频繁，请稍后再试");
  }

  // ② 待审上限：避免单用户灌满审核队列。
  const [pend] = (await sql`
    SELECT COUNT(*)::int AS n FROM inspiration_submissions
    WHERE user_id = ${userId} AND status = 'pending'`) as Array<{ n: number }>;
  if (Number(pend?.n ?? 0) >= INSPIRATION_SUBMISSION_MAX_PENDING) {
    throw httpError(429, "RATE_LIMITED", "待审投稿过多，请等管理员审核后再投");
  }

  // ③ 归属校验：仅能投自己的图，且从 DB 取权威 key/url/宽高（绝不信客户端）。
  const [img] = (await sql`
    SELECT storage_key, public_url, width, height FROM images
    WHERE id = ${input.imageId} AND user_id = ${userId} LIMIT 1`) as Row[];
  if (!img) throw httpError(404, "NOT_FOUND", "图片不存在或不属于你");

  // ④ 同图去重：同一张图已有 pending、或仍在架的 approved 投稿则拒。
  //    approved 但上架卡已被站长删除 → 不再拦（允许重投，审查 confirmed#3）。
  const dup = (await sql`
    SELECT 1 FROM inspiration_submissions s
    WHERE s.user_id = ${userId} AND s.source_image_id = ${input.imageId}
      AND (
        s.status = 'pending'
        OR (s.status = 'approved'
            AND EXISTS (SELECT 1 FROM inspirations i WHERE i.id = s.published_inspiration_id))
      )
    LIMIT 1`) as Row[];
  if (dup.length > 0) throw httpError(400, "INVALID_PARAM", "这张图已投过稿，不能重复投");

  // ⑤ 复制永久副本（pending 受孤儿保护；通过后 inspirations.cover_key 复用同一对象）。
  const copyFn = deps.copy ?? ((k: string, u: string) => copyToInspirationSubmission(k, u));
  const { storageKey, publicUrl } = await copyFn(img.storage_key as string, userId);

  // ⑥ 落投稿行 + 事件（同事务）。
  const width = img.width === null || img.width === undefined ? null : Number(img.width);
  const height = img.height === null || img.height === undefined ? null : Number(img.height);
  try {
    return await tx(async (c: TxClient) => {
      const r = await c.query(
        `INSERT INTO inspiration_submissions
           (user_id, source_image_id, image_key, image_url, width, height, title, prompt, category, summary, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
        [
          userId,
          input.imageId,
          storageKey,
          publicUrl,
          width,
          height,
          input.title,
          input.prompt,
          input.category ?? null,
          input.summary ?? null,
        ],
      );
      const id = r.rows[0].id as string;
      await c.query(
        `INSERT INTO events(type, user_id, payload)
         VALUES('inspiration_submit', $1, jsonb_build_object('submissionId', $2::text, 'imageId', $3::text))`,
        [userId, id, input.imageId],
      );
      return { id, status: "pending" as const };
    });
  } catch (e) {
    // 并发兜底（审查 confirmed#1）：同图同时投两条 pending → 唯一索引 uq_insp_sub_pending_src 冲突(23505)。
    // 友好提示；落选请求的副本无 DB 行引用，由孤儿 cron(>1h) 回收。
    if (e && typeof e === "object" && (e as { code?: string }).code === "23505") {
      throw httpError(400, "INVALID_PARAM", "这张图已投过稿，不能重复投");
    }
    throw e;
  }
}

/** 我的投稿（owner-scoped 近 50 条，含状态/驳回原因）。 */
export async function listMySubmissions(userId: string): Promise<MySubmissionsResponse> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, image_url, title, prompt, category, summary, status, review_reason, created_at
    FROM inspiration_submissions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      image: r.image_url as string,
      title: r.title as string,
      prompt: r.prompt as string,
      category: (r.category as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      status: r.status as MySubmissionsResponse["items"][number]["status"],
      reviewReason: (r.review_reason as string | null) ?? null,
      createdAt: iso(r.created_at),
    })),
  };
}
