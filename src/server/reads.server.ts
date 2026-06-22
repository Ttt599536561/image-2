// ★server-only：前台读路径（08 §9.2「读走 loader(SSR)」）+ 少量写助手。
// 全走 HTTP 单语句 getSql()（看板/列表只读；金额单笔 number、SUM 走 ::text string codec，07 §8.5）。
// 同一函数既供 loader 取首屏 initialData，也供 /api/* 资源路由客户端 refetch（单一真相源，零重复）。
//
// 🔴 红线：一律 owner-scoped（WHERE user_id=$me）防越权；金额 bigint 经 HTTP 返字符串 → Number() 单笔安全、
//    SUM 留 ::text；前端只读 images.public_url；删除同时尽力删 Supabase 对象（孤儿由清理 cron 兜底）。
import type { ConversationDetail, ConversationListResponse } from "../contracts/conversation";
import type { ImageRange, ImagesResponse, SaveResponse } from "../contracts/image";
import type { InspirationItem, InspirationsResponse } from "../contracts/inspiration";
import type { LedgerResponse } from "../contracts/account";
import type { MeResponse } from "../contracts/me";
import type { NotificationListResponse } from "../contracts/notification";
import type { PackagesResponse } from "../contracts/package";
import { getSql } from "../db/db.server";
import { SEED_INSPIRATIONS } from "./inspirations.server";
import { deleteManyFromR2 } from "./r2.server";

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string | number | Date).toISOString();

// ===================== /api/me =====================
export async function loadMe(userId: string): Promise<MeResponse> {
  const sql = getSql();
  const [u] = (await sql`
    SELECT u.id, u.email, u.role, u.max_concurrency, u.has_paid, u.created_at,
           COALESCE(a.balance_mp, 0) AS balance_mp
    FROM users u LEFT JOIN credit_accounts a ON a.user_id = u.id
    WHERE u.id = ${userId} LIMIT 1`) as Row[];
  if (!u) throw new Response("用户不存在", { status: 404 });
  // 3 天内即将过期的剩余毫积分（07 §8.3 SQL，mp 走 string codec）。
  const [exp] = (await sql`
    SELECT COALESCE(SUM(remaining_mp), 0)::text AS mp, MIN(expires_at) AS nearest
    FROM credit_lots
    WHERE user_id = ${userId} AND remaining_mp > 0
      AND expires_at IS NOT NULL AND expires_at < now() + interval '3 days'`) as Row[];
  return {
    user: {
      id: u.id as string,
      email: u.email as string,
      role: u.role as string,
      createdAt: iso(u.created_at),
    },
    balanceMp: num(u.balance_mp),
    maxConcurrency: num(u.max_concurrency),
    hasPaid: u.has_paid === true,
    expiringSoon: { mp: String(exp?.mp ?? "0"), nearestExpiresAt: isoOrNull(exp?.nearest) },
  };
}

// ===================== /api/conversations（列表，倒序分页） =====================
export async function loadConversations(
  userId: string,
  page = 1,
  pageSize = 20,
  q?: string,
): Promise<ConversationListResponse> {
  const sql = getSql();
  const offset = (page - 1) * pageSize;
  const like = likePattern(q); // P3-S2 标题搜索，null=不过滤
  const items = (await sql`
    SELECT id, title, updated_at FROM conversations
    WHERE user_id = ${userId}
      AND (${like}::text IS NULL OR title ILIKE ${like})
    ORDER BY updated_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n FROM conversations
    WHERE user_id = ${userId} AND (${like}::text IS NULL OR title ILIKE ${like})`) as Row[];
  return {
    items: items.map((r) => ({ id: r.id as string, title: r.title as string, updatedAt: iso(r.updated_at) })),
    page,
    pageSize,
    total: num(c?.n),
  };
}

// ===================== /api/conversations/:id（详情，含 generations 正序） =====================
export async function loadConversationDetail(userId: string, id: string): Promise<ConversationDetail> {
  const sql = getSql();
  const [conv] = (await sql`
    SELECT id, title, created_at, updated_at FROM conversations
    WHERE id = ${id} AND user_id = ${userId} LIMIT 1`) as Row[];
  if (!conv) throw new Response("会话不存在", { status: 404 });
  const gens = (await sql`
    SELECT g.id, g.prompt, g.size, g.quality, g.background, g.status, g.error_code, g.error,
           g.http_status, g.credits_charged_mp, g.duration_ms, g.created_at,
           i.id AS image_id, i.public_url, i.width, i.height, i.saved_to_library
    FROM generations g LEFT JOIN images i ON i.generation_id = g.id
    WHERE g.conversation_id = ${id} AND g.user_id = ${userId}
    ORDER BY g.created_at ASC`) as Row[];
  return {
    id: conv.id as string,
    title: conv.title as string,
    createdAt: iso(conv.created_at),
    updatedAt: iso(conv.updated_at),
    generations: gens.map((g) => ({
      id: g.id as string,
      prompt: g.prompt as string,
      size: g.size as string,
      quality: (g.quality as string | null) ?? null,
      background: (g.background as string | null) ?? null,
      status: g.status as ConversationDetail["generations"][number]["status"],
      errorCode: (g.error_code as ConversationDetail["generations"][number]["errorCode"]) ?? null,
      error: (g.error as string | null) ?? null,
      httpStatus: numOrNull(g.http_status),
      creditsChargedMp: num(g.credits_charged_mp),
      durationMs: numOrNull(g.duration_ms),
      createdAt: iso(g.created_at),
      image: g.public_url
        ? {
            id: g.image_id as string,
            publicUrl: g.public_url as string,
            width: numOrNull(g.width),
            height: numOrNull(g.height),
            savedToLibrary: g.saved_to_library === true,
          }
        : null,
    })),
  };
}

// ===================== /api/images（资产库，日期筛选 + 分页） =====================
function rangeLowerBound(range: ImageRange | undefined, from: string | undefined): string | null {
  switch (range) {
    case "today":
      return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    case "7d":
      return new Date(Date.now() - 7 * 86_400_000).toISOString();
    case "30d":
      return new Date(Date.now() - 30 * 86_400_000).toISOString();
    case "custom":
      return from ? new Date(from).toISOString() : null;
    default:
      return null; // all
  }
}

/** 搜索词 → ILIKE 模式（P3-S2）。转义 LIKE 元字符 \%_ 防用户输入当通配；null=不过滤。ILIKE 默认转义符 `\`。 */
function likePattern(q: string | undefined): string | null {
  const s = q?.trim();
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function loadImages(
  userId: string,
  query: { range?: ImageRange; from?: string; to?: string; q?: string; page?: number; pageSize?: number },
): Promise<ImagesResponse> {
  const sql = getSql();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const lower = rangeLowerBound(query.range, query.from);
  const upper = query.range === "custom" && query.to ? new Date(query.to).toISOString() : null;
  const like = likePattern(query.q); // P3-S2 按提示词搜索，null=不过滤
  // prompt 在 generations 表（images 无此列）→ join 取回（count 同 join 以支持 prompt 过滤）。
  const items = (await sql`
    SELECT i.id, i.generation_id, g.prompt, i.public_url, i.width, i.height,
           i.created_at, i.expires_at, i.saved_to_library
    FROM images i JOIN generations g ON g.id = i.generation_id
    WHERE i.user_id = ${userId}
      AND (${lower}::timestamptz IS NULL OR i.created_at >= ${lower}::timestamptz)
      AND (${upper}::timestamptz IS NULL OR i.created_at <= ${upper}::timestamptz)
      AND (${like}::text IS NULL OR g.prompt ILIKE ${like})
    ORDER BY i.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`
    SELECT COUNT(*)::int AS n FROM images i JOIN generations g ON g.id = i.generation_id
    WHERE i.user_id = ${userId}
      AND (${lower}::timestamptz IS NULL OR i.created_at >= ${lower}::timestamptz)
      AND (${upper}::timestamptz IS NULL OR i.created_at <= ${upper}::timestamptz)
      AND (${like}::text IS NULL OR g.prompt ILIKE ${like})`) as Row[];
  return {
    items: items.map((r) => ({
      id: r.id as string,
      generationId: r.generation_id as string,
      prompt: r.prompt as string,
      publicUrl: r.public_url as string,
      width: numOrNull(r.width),
      height: numOrNull(r.height),
      createdAt: iso(r.created_at),
      expiresAt: isoOrNull(r.expires_at),
      savedToLibrary: r.saved_to_library === true,
    })),
    page,
    pageSize,
    total: num(c?.n),
  };
}

/** 存入资产库（置 saved_to_library=true，owner-scoped）。404 若该 generation 无图/非本人。 */
export async function saveImageToLibrary(userId: string, generationId: string): Promise<SaveResponse> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE images SET saved_to_library = true
    WHERE generation_id = ${generationId} AND user_id = ${userId}
    RETURNING id`) as Row[];
  if (rows.length === 0) throw new Response("图片不存在", { status: 404 });
  return { id: rows[0].id as string, savedToLibrary: true };
}

/** 批量删除（owner-scoped，不可恢复）。先删 DB 行（权威），再尽力删 Supabase 对象（失败留孤儿由 cron 兜底）。 */
export async function deleteImages(userId: string, ids: string[]): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 };
  const sql = getSql();
  const rows = (await sql`
    DELETE FROM images WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[])
    RETURNING storage_key`) as Row[];
  const keys = rows.map((r) => r.storage_key as string).filter(Boolean);
  if (keys.length > 0) {
    try {
      const failed = await deleteManyFromR2(keys);
      if (failed.length > 0) console.error("[deleteImages] R2 删除部分失败（孤儿由清理 cron 兜底）", failed.length);
    } catch (e) {
      console.error("[deleteImages] R2 删除异常（DB 行已删，孤儿由清理 cron 兜底）", e);
    }
  }
  return { deleted: rows.length };
}

// ===================== /api/packages（充值套餐，前台 active+sort） =====================
export async function loadPackages(): Promise<PackagesResponse> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, title, description, price_cash, credits_mp, valid_days, redirect_url
    FROM packages WHERE active = true ORDER BY sort ASC, created_at ASC`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      priceCash: num(r.price_cash),
      creditsMp: num(r.credits_mp),
      validDays: numOrNull(r.valid_days),
      redirectUrl: (r.redirect_url as string | null) ?? null,
    })),
  };
}

// ===================== /api/account/ledger（积分流水，倒序分页） =====================
export async function loadLedger(userId: string, page = 1, pageSize = 20): Promise<LedgerResponse> {
  const sql = getSql();
  const offset = (page - 1) * pageSize;
  const items = (await sql`
    SELECT id, entry_type, amount_mp, balance_after_mp, reason, ref_type, ref_id, created_at
    FROM credit_ledger WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id = ${userId}`) as Row[];
  return {
    items: items.map((r) => ({
      id: r.id as string,
      entryType: r.entry_type as LedgerResponse["items"][number]["entryType"],
      amountMp: num(r.amount_mp),
      balanceAfterMp: num(r.balance_after_mp),
      reason: (r.reason as string | null) ?? null,
      refType: (r.ref_type as string | null) ?? null,
      refId: (r.ref_id as string | null) ?? null,
      createdAt: iso(r.created_at),
    })),
    total: num(c?.n),
    page,
    pageSize,
  };
}

// ===================== /api/notifications（站内通知；目前仅 image_expiring） =====================
export async function loadNotifications(userId: string, unreadOnly: boolean): Promise<NotificationListResponse> {
  const sql = getSql();
  const rows = unreadOnly
    ? ((await sql`
        SELECT id, type, payload, read_at, created_at FROM notifications
        WHERE user_id = ${userId} AND read_at IS NULL
        ORDER BY created_at DESC LIMIT 50`) as Row[])
    : ((await sql`
        SELECT id, type, payload, read_at, created_at FROM notifications
        WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 50`) as Row[]);
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      type: r.type as "image_expiring",
      payload: (r.payload as Record<string, unknown> | null) ?? null,
      readAt: isoOrNull(r.read_at),
      createdAt: iso(r.created_at),
    })),
  };
}

/** 标记已读：缺省 ids → 全标该用户未读。返回标记数。 */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<{ marked: number }> {
  const sql = getSql();
  const rows =
    ids && ids.length > 0
      ? ((await sql`
          UPDATE notifications SET read_at = now()
          WHERE user_id = ${userId} AND read_at IS NULL AND id = ANY(${ids}::uuid[])
          RETURNING id`) as Row[])
      : ((await sql`
          UPDATE notifications SET read_at = now()
          WHERE user_id = ${userId} AND read_at IS NULL
          RETURNING id`) as Row[]);
  return { marked: rows.length };
}

// ===================== /api/inspirations（灵感库，只读） =====================
// 优先查 inspirations 表（§6 admin 维护）；表未建/为空 → 回退服务端种子（保证欢迎画廊不空）。品类/搜索本地过滤。
export async function loadInspirations(category?: string, q?: string): Promise<InspirationsResponse> {
  let base: InspirationItem[] = SEED_INSPIRATIONS;
  try {
    const rows = (await getSql()`
      SELECT id, cover_url, title, summary, prompt, category FROM inspirations
      WHERE active = true ORDER BY sort ASC, created_at DESC`) as Row[];
    if (rows.length > 0) {
      base = rows.map((r) => ({
        id: r.id as string,
        cover: r.cover_url as string,
        title: r.title as string,
        summary: (r.summary as string | null) ?? null,
        prompt: r.prompt as string,
        category: (r.category as string | null) ?? null,
        width: null,
        height: null,
      }));
    }
  } catch {
    // 表未建 → 回退种子
  }
  const needle = (q ?? "").trim().toLowerCase();
  const items = base
    .filter((i) => !category || category === "全部" || i.category === category)
    .filter(
      (i) =>
        !needle ||
        i.title.toLowerCase().includes(needle) ||
        (i.summary ?? "").toLowerCase().includes(needle) ||
        i.prompt.toLowerCase().includes(needle),
    );
  return { items };
}
