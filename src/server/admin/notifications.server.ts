// ★server-only：后台广播公告（§9）。广播 = 给目标用户每人插一行 announcement 通知（INSERT...SELECT）。
// dedupe_key = announcement:<aid>:<userId>，唯一索引(uq_notif_dedupe)保幂等——同一公告（同 aid）复发不重复插。
// 🔴 红线：写端点 requireAdmin（路由层）+ 二次确认（撰写页）+ 写操作审计；前台只读本人通知（loadNotifications owner-scoped）。
// 🔴 原子性：INSERT 与审计同一事务（tx + writeAudit，同 inspiration/codes/packages 范式）——审计失败则整体 ROLLBACK、
//    公告不落库，管理员重试（新 aid）天然安全、不会把一波公告重复下发（广播「不可撤回」、爆炸半径=全体目标）。
import { randomUUID } from "node:crypto";
import { getSql } from "../../db/db.server";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

export type BroadcastTarget = "all" | "paid";

export interface BroadcastArgs {
  adminId: string;
  title: string;
  body: string;
  link?: string | null;
  target: BroadcastTarget;
  ip?: string | null;
}

/** 目标用户数（撰写页二次确认「将给 N 个用户下发」）。一条聚合查询给全体 + 付费两口径。 */
export async function notificationTargetCounts(): Promise<{ all: number; paid: number }> {
  const sql = getSql();
  const [r] = (await sql`
    SELECT COUNT(*)::int AS all_n,
           COUNT(*) FILTER (WHERE has_paid = true)::int AS paid_n
    FROM users`) as Row[];
  return { all: Number(r?.all_n ?? 0), paid: Number(r?.paid_n ?? 0) };
}

/**
 * 广播公告：目标用户每人插一行 announcement。INSERT...SELECT，payload={title,body,link}；
 * dedupe_key 含本次公告 uuid → 唯一保幂等（同一 aid 复发因 ON CONFLICT DO NOTHING 不重复插）。
 * INSERT + 审计同事务：审计失败 → ROLLBACK → 公告不落库（避免「插了但审计没写」+ 重试时 aid 变新 → 重复下发）。
 * 返回实际新插条数（inserted）+ 本次公告 id（aid）。
 */
export async function broadcastAnnouncement(
  args: BroadcastArgs,
): Promise<{ inserted: number; announcementId: string }> {
  const aid = randomUUID();
  const payload = JSON.stringify({ title: args.title, body: args.body, link: args.link ?? null });
  // 目标二选一：全体 / 仅付费（has_paid=true）。where 为固定内部串（非用户输入），无注入。
  const where = args.target === "paid" ? "WHERE has_paid = true" : "";
  return tx(async (c: TxClient) => {
    const r = await c.query(
      `INSERT INTO notifications(user_id, type, payload, dedupe_key)
       SELECT id, 'announcement', $1::jsonb, 'announcement:' || $2 || ':' || id::text
       FROM users ${where}
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [payload, aid],
    );
    const inserted = r.rows.length;
    await writeAudit(c, {
      adminId: args.adminId,
      action: "broadcast_notification",
      targetType: "notification",
      targetId: aid,
      after: { title: args.title, target: args.target, hasLink: !!args.link, inserted },
      ip: args.ip ?? null,
    });
    return { inserted, announcementId: aid };
  });
}

// ===================== ①增强：已发公告列表 + 编辑 / 删除（2026-06-22）=====================
// 广播为 per-user 散插、无聚合实体：公告 id(aid) 藏在 dedupe_key='announcement:<aid>:<uid>' 第 2 段。
// 列表按 aid 聚合（接收数 / 已读数 / 时间 + 代表 payload）；目标(all/paid) 不落 notifications 行，
// 从 broadcast_notification 审计的 after.target 回捞（历史无审计则 null）。免迁移（aid 从 dedupe_key 拆）。

export interface AnnouncementSummary {
  aid: string;
  title: string;
  body: string;
  link: string | null;
  target: BroadcastTarget | null; // 从审计回捞；缺则 null
  recipients: number; // 接收用户数
  readCount: number; // 已读数（read_at 非空）
  createdAt: string; // 首次下发时间
}

/** jsonb 列在 neon 驱动多半已解析为对象；防御兼容字符串。 */
function asPayload(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

/** 已发公告聚合列表（最多 limit 条，按首次下发时间倒序）。 */
export async function listAnnouncements(limit = 200): Promise<{ items: AnnouncementSummary[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT n.aid, n.payload, n.recipients, n.read_count, n.created_at, a.target
    FROM (
      SELECT split_part(dedupe_key, ':', 2) AS aid,
             (array_agg(payload ORDER BY created_at ASC))[1] AS payload,
             COUNT(*)::int AS recipients,
             COUNT(read_at)::int AS read_count,
             MIN(created_at) AS created_at
      FROM notifications
      WHERE type = 'announcement'
      GROUP BY split_part(dedupe_key, ':', 2)
    ) n
    LEFT JOIN LATERAL (
      SELECT after->>'target' AS target
      FROM audit_log
      WHERE action = 'broadcast_notification' AND target_id = n.aid
      ORDER BY created_at ASC
      LIMIT 1
    ) a ON true
    ORDER BY n.created_at DESC
    LIMIT ${limit}`) as Row[];
  return {
    items: rows.map((r) => {
      const p = asPayload(r.payload);
      const t = r.target as string | null;
      return {
        aid: r.aid as string,
        title: asStr(p.title),
        body: asStr(p.body),
        link: asStr(p.link) || null,
        target: t === "all" || t === "paid" ? t : null,
        recipients: Number(r.recipients ?? 0),
        readCount: Number(r.read_count ?? 0),
        createdAt: new Date(r.created_at as string).toISOString(),
      };
    }),
  };
}

/**
 * 编辑已发公告：把这波 'announcement:<aid>:%' 行的 payload 全量替换（同步用户端）。
 * renotify=true → 同事务把 read_at 置 NULL「重新提醒」（前台红点重弹）；默认静默改内容。
 * 0 行命中 → 404（公告不存在）。aid 已由契约 z.uuid 校验，LIKE 模式无通配注入。
 */
export async function editAnnouncement(args: {
  adminId: string;
  aid: string;
  title: string;
  body: string;
  link?: string | null;
  renotify: boolean;
  ip?: string | null;
}): Promise<{ affected: number }> {
  const payload = JSON.stringify({ title: args.title, body: args.body, link: args.link ?? null });
  return tx(async (c: TxClient) => {
    const before = (
      await c.query(
        `SELECT payload FROM notifications
         WHERE type='announcement' AND dedupe_key LIKE 'announcement:' || $1 || ':%'
         LIMIT 1`,
        [args.aid],
      )
    ).rows[0];
    if (!before) throw new Response("公告不存在", { status: 404 });
    const r = await c.query(
      `UPDATE notifications
       SET payload = $2::jsonb,
           read_at = CASE WHEN $3::boolean THEN NULL ELSE read_at END
       WHERE type='announcement' AND dedupe_key LIKE 'announcement:' || $1 || ':%'`,
      [args.aid, payload, args.renotify],
    );
    const affected = r.rowCount ?? 0;
    await writeAudit(c, {
      adminId: args.adminId,
      action: "edit_announcement",
      targetType: "notification",
      targetId: args.aid,
      before: before.payload ?? null,
      after: {
        title: args.title,
        hasLink: !!args.link,
        renotify: args.renotify,
        affected,
      },
      ip: args.ip ?? null,
    });
    return { affected };
  });
}

/** 删除已发公告：批量删该波行（用户端立即消失）+ 审计。0 行命中 → 404。 */
export async function deleteAnnouncement(args: {
  adminId: string;
  aid: string;
  ip?: string | null;
}): Promise<{ affected: number }> {
  return tx(async (c: TxClient) => {
    const info = (
      await c.query(
        `SELECT (array_agg(payload))[1] AS payload, COUNT(*)::int AS recipients
         FROM notifications
         WHERE type='announcement' AND dedupe_key LIKE 'announcement:' || $1 || ':%'`,
        [args.aid],
      )
    ).rows[0];
    const recipients = Number(info?.recipients ?? 0);
    if (recipients === 0) throw new Response("公告不存在", { status: 404 });
    const r = await c.query(
      `DELETE FROM notifications
       WHERE type='announcement' AND dedupe_key LIKE 'announcement:' || $1 || ':%'`,
      [args.aid],
    );
    const affected = r.rowCount ?? 0;
    await writeAudit(c, {
      adminId: args.adminId,
      action: "delete_announcement",
      targetType: "notification",
      targetId: args.aid,
      before: { payload: info?.payload ?? null, recipients },
      ip: args.ip ?? null,
    });
    return { affected };
  });
}
