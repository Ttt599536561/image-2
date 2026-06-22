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
