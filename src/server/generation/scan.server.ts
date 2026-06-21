// ★server-only：超时重扫 + queued 派发兜底（cron · 真相源 04 §5.5 / 10 §11.6）。
// 全 HTTP 单语句（只读扫描 + 单语句原子 UPDATE…RETURNING 即原子，无需事务）。失败从不进扣费事务（天然未扣）；
// 行进终态即从并发 COUNT(queued/claimed/running) 移出，无双减/漏减。
//
// 🔴 红线：
//  - duration_ms 用 (EXTRACT(EPOCH FROM …)*1000)::int（绝不 EXTRACT(MILLISECONDS)：只返秒分量、≥1min 截断到 ≤59999，
//    超时行恰 ≥5min 必踩坑）。
//  - 时间基准 COALESCE(started_at, updated_at)：兜底「claimed 但未写 started_at 即被平台杀」的僵尸行 + 孤儿 queued。
//  - 终态行不再命中（status IN(queued,claimed,running) 谓词），可被平台重复触发/手动重跑而幂等。
//  - 成功事务（UPDATE…WHERE status='running'，03 §4.3）与本 cron 互斥于行锁/状态谓词：先到先得、都只认中间态，终态行不再被改。
import { getSql } from "../../db/db.server";
import { triggerBackground } from "./trigger";

/**
 * 超时重扫（5min 权威判定，§11.6）：queued/claimed/running 且 COALESCE(started_at,updated_at) < now()-5min
 *  → failed/provider_timeout（兜底僵尸 claimed + 超龄孤儿 queued，§5.5）。逐行写 image_failed 事件。
 * 返回被置 failed 的行（供 cron 告警 queue_timeout_rescan）。
 */
export async function rescanTimeouts(): Promise<{ id: string; userId: string }[]> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE generations
    SET status='failed', error_code='provider_timeout', error='provider_timeout', completed_at=now(),
        duration_ms=(EXTRACT(EPOCH FROM now()-COALESCE(started_at, updated_at))*1000)::int, updated_at=now()
    WHERE status IN ('queued','claimed','running')
      AND COALESCE(started_at, updated_at) < now() - interval '5 minutes'
    RETURNING id, user_id`) as Array<{ id: string; user_id: string }>;
  for (const g of rows) {
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('image_failed', ${g.user_id}, ${JSON.stringify({ generationId: g.id, reason: "provider_timeout" })}::jsonb)`;
  }
  return rows.map((g) => ({ id: g.id, userId: g.user_id }));
}

/**
 * 派发兜底（常驻、§5.5）：扫仍 queued 且非短暂在途（updated_at < now()-1min）的行，重新 fire-and-forget 触发后台。
 * 主路径仍是入队后立即触发；本兜底只补「触发 fetch 偶发失败」的行。抢占式状态机（claim 原子）保证重发不重复下单。
 * 超 5min 的孤儿 queued 已被 rescanTimeouts 收为 failed，故此处只命中 1–5min 区间（先 rescan 后 dispatch 排序保证）。
 */
export async function dispatchStaleQueued(limit = 100): Promise<string[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id FROM generations
    WHERE status='queued' AND updated_at < now() - interval '1 minute'
    ORDER BY created_at ASC
    LIMIT ${limit}`) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  for (const id of ids) await triggerBackground(id); // fire-and-forget，触发失败只记日志、不抛
  return ids;
}
