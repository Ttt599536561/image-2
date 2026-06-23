// ★server-only：图片清理 cron 逻辑（真相源 06 §7.5 / 10 §11.7）。
// 顺序固定 ⓪预扫通知 → ①付费顺延兜底 → ②删过期图(先删 R2 再删 DB 行 + image_cleaned) → ③扫孤儿。
// 扫描/删行走 HTTP getSql()（非钱事务）；R2 删除/列举经注入的 deps（默认真实，测试可桩，免烧 Supabase）。
//
// 🔴 红线：
//  - 先删 R2 对象、再删 DB 行（反过来会留「DB 没记录、R2 还在」的孤儿，更难追）；删失败的 key 不删对应 DB 行、下轮重扫。
//  - 通知 dedupe_key=image_expiring:<图id> + ON CONFLICT DO NOTHING（cron 每日重跑/重复触发不重发同一条）。
//  - 孤儿保护窗口 LastModified>1h（避免误删一张刚 PUT、扣费事务还没 COMMIT 的在途图）。
//  - 仅「图片到期前 1 天」用 notifications 表；积分到期走 /api/me 实时字段 expiringSoon、不入此表。
import { getSql } from "../db/db.server";
import {
  deleteManyFromR2 as realDeleteMany,
  listStorageObjects as realListObjects,
  type StorageObject,
} from "./r2.server";

export interface CleanupDeps {
  deleteMany?: (keys: string[]) => Promise<string[]>; // 返回未删成功的 key（部分成功）
  listObjects?: (maxPages?: number) => Promise<StorageObject[]>;
}

export interface CleanupResult {
  notified: number; // ⓪ 新写的到期前通知条数
  renewed: number; // ① 付费顺延的图行数
  deletedImages: number; // ② 删除的过期图行数
  failedKeys: number; // ② R2 删除失败、保留待下轮重扫的 key 数
  orphansDeleted: number; // ③ 清理的孤儿对象数
  orphanError: boolean; // ③ 孤儿清理是否出错（best-effort，不影响主路径）
}

const DELETE_BATCH = 500;
const MAX_DELETE_ITERS = 20; // 单轮上限 1万图，防单次 cron 超时；未尽下轮再清

/**
 * ⓪ 到期前 1 天预扫 → 站内通知（dedupe ON CONFLICT DO NOTHING）。**必须在删图前做**，
 * 否则今晚就到期的图来不及提示。返回本轮新写的通知条数。
 */
export async function prescanExpiringNotifications(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO notifications(user_id, type, payload, dedupe_key)
    SELECT user_id, 'image_expiring',
           jsonb_build_object('imageId', id, 'expiresAt', expires_at),
           'image_expiring:'||id
    FROM images
    WHERE expires_at IS NOT NULL AND expires_at BETWEEN now() AND now() + interval '1 day'
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  return rows.length;
}

/**
 * ① 付费顺延兜底（money-6）：删图前对 has_paid=true 用户「已到期」的图把 expires_at 顺延 60 天，
 * 避免「已兑码升级却被按旧保留期清」的漏网图被误删；顺延后这些行不再命中步骤②。返回顺延行数。
 */
export async function renewPaidExpired(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    UPDATE images i SET expires_at = now() + interval '60 days'
    FROM users u
    WHERE i.user_id = u.id AND u.has_paid = true
      AND i.expires_at IS NOT NULL AND i.expires_at < now()
    RETURNING i.id`;
  return rows.length;
}

/**
 * ② 删过期图：分批「先删 R2 再删 DB 行 + image_cleaned 事件」。删失败的 key 保留 DB 行、下轮重扫
 * （expires_at<now 仍会被再选中）。返回 {deleted, failedKeys}。
 */
export async function deleteExpiredImages(deps: CleanupDeps = {}): Promise<{ deleted: number; failedKeys: number }> {
  const deleteMany = deps.deleteMany ?? realDeleteMany;
  const sql = getSql();
  let deleted = 0;
  let failedKeys = 0;

  for (let iter = 0; iter < MAX_DELETE_ITERS; iter += 1) {
    const rows = (await sql`
      SELECT id, generation_id, user_id, storage_key FROM images
      WHERE expires_at IS NOT NULL AND expires_at < now()
      ORDER BY expires_at ASC
      LIMIT ${DELETE_BATCH}`) as Array<{ id: string; generation_id: string; user_id: string; storage_key: string }>;
    if (rows.length === 0) break;

    // 1) 先删 R2 对象（部分成功：返回未删成功的 key）。
    const failed = new Set(await deleteMany(rows.map((r) => r.storage_key)));
    failedKeys += failed.size;

    // 只删「R2 已删成功」的行。全失败 → 跳出避免死循环（下轮再试）。
    const okRows = rows.filter((r) => !failed.has(r.storage_key));
    if (okRows.length === 0) break;

    // 2) 删 DB 行（保留 generations 行做历史/看板事实；只删 images）。
    const ids = okRows.map((r) => r.id);
    await sql`DELETE FROM images WHERE id = ANY(${ids}::uuid[])`;

    // 3) 写 image_cleaned 事件（append-only；批量 unnest 一条 INSERT，省 HTTP 往返）。
    await sql`
      INSERT INTO events(type, user_id, payload)
      SELECT 'image_cleaned', t.user_id,
             jsonb_build_object('generationId', t.generation_id, 'storageKey', t.storage_key, 'reason', 'retention_expired')
      FROM unnest(${okRows.map((r) => r.user_id)}::uuid[], ${okRows.map((r) => r.generation_id)}::uuid[], ${okRows.map((r) => r.storage_key)}::text[])
           AS t(user_id, generation_id, storage_key)`;

    // 4) 连带删该图的 image_expiring 到期提醒（dedupe_key='image_expiring:'||id）。图已不存在，提醒不应滞留——
    //    ② 铃铛改「看完仍保留全部 50 条」后，残留的到期提醒会永久灰显、点击跳向已删图、并挤占公告名额。
    await sql`
      DELETE FROM notifications
      WHERE type = 'image_expiring'
        AND dedupe_key = ANY(${okRows.map((r) => `image_expiring:${r.id}`)}::text[])`;

    deleted += okRows.length;
    if (rows.length < DELETE_BATCH) break; // 末批，清空了
  }
  return { deleted, failedKeys };
}

/**
 * ③ 孤儿对象清理（扣费事务 ROLLBACK 后留在 R2、无 images 行的对象，§7.5 B）。best-effort。
 * 保护窗口 LastModified>1h 避开在途图；R2 有、DB images.storage_key 没有 = 孤儿。返回清理数。
 */
export async function sweepOrphanR2Objects(deps: CleanupDeps = {}): Promise<{ orphansDeleted: number }> {
  const listObjects = deps.listObjects ?? realListObjects;
  const deleteMany = deps.deleteMany ?? realDeleteMany;
  const sql = getSql();
  const cutoff = Date.now() - 3600_000; // 1h 保护窗口

  const objects = await listObjects();
  const aged = objects.filter((o) => o.lastModified > 0 && o.lastModified < cutoff).map((o) => o.key);
  if (aged.length === 0) return { orphansDeleted: 0 };

  // 分批比对 DB（IN 列表 ≤1000/批）。
  let orphansDeleted = 0;
  for (let i = 0; i < aged.length; i += 1000) {
    const keys = aged.slice(i, i + 1000);
    // known = 成品图 storage_key ∪ 「在途」(未终态)生成的参考图 input_image_key（④b）∪ 在用的灵感封面 cover_key。
    // ① 参考图保护：上传后生成还没跑完时，参考图 key 虽不在 images 里，也不能被当孤儿误删。
    // ② 灵感封面保护：admin 上传的封面（inspirations/…）由灵感 CRUD 管理，**在用的绝不能被孤儿清理误删**；
    //    删除/替换灵感卡后 cover_key 不再命中 → 自动按孤儿(>1h)回收（含 admin 上传后未保存的废弃封面）。
    // 已终态(succeeded/failed)生成的参考图 + 从没关联生成的废弃上传 → 不在 known → 按孤儿(>1h)回收（用后即弃）。
    const known = new Set(
      (
        (await sql`
          SELECT storage_key AS k FROM images WHERE storage_key = ANY(${keys}::text[])
          UNION
          SELECT input_image_key AS k FROM generations
            WHERE input_image_key = ANY(${keys}::text[])
              AND status IN ('queued','claimed','running')
          UNION
          SELECT cover_key AS k FROM inspirations WHERE cover_key = ANY(${keys}::text[])`) as Array<{ k: string }>
      ).map((r) => r.k),
    );
    const orphans = keys.filter((k) => !known.has(k));
    if (orphans.length === 0) continue;
    const failed = new Set(await deleteMany(orphans));
    const reallyDeleted = orphans.filter((k) => !failed.has(k));
    orphansDeleted += reallyDeleted.length;
    if (reallyDeleted.length > 0) {
      await sql`INSERT INTO events(type, payload) VALUES('image_cleaned', ${JSON.stringify({ orphanCount: reallyDeleted.length })}::jsonb)`;
    }
  }
  return { orphansDeleted };
}

/** 清理 cron 编排：⓪预扫通知 → ①付费顺延 → ②删过期图 → ③扫孤儿（孤儿 best-effort、不影响主路径）。 */
export async function cleanExpiredImages(deps: CleanupDeps = {}): Promise<CleanupResult> {
  const notified = await prescanExpiringNotifications();
  const renewed = await renewPaidExpired();
  const { deleted, failedKeys } = await deleteExpiredImages(deps);
  let orphansDeleted = 0;
  let orphanError = false;
  try {
    orphansDeleted = (await sweepOrphanR2Objects(deps)).orphansDeleted;
  } catch (e) {
    orphanError = true;
    console.error("[maintenance] 孤儿清理失败（不影响过期清理主路径）", e);
  }
  return { notified, renewed, deletedImages: deleted, failedKeys, orphansDeleted, orphanError };
}
