// ★server-only：抢占式状态机（铁律③，真相源 03 §4.5 / 04 §5.3）。挡 worker 重领
//   / scheduler 重扫的「重复下单 + 重复扣费」。两步都是原子单语句，无需显式事务。
//
// 🔴 红线：claim 必须是 worker 处理任务的第一件事——`UPDATE…WHERE status='queued' RETURNING`，affected=0 立即退、
//   不调中转、不扣费；只有第一个把 queued→claimed 的实例能继续。
import { randomUUID } from "node:crypto";
import { getSql, usesPgDriver } from "../../db/db.server";

export interface ClaimedGeneration {
  id: string;
  userId: string;
  prompt: string;
  size: string;
  quality: string | null;
  background: string | null;
  inputImageKey: string | null; // ④b 图生图：有值 → callRelay 走 /images/edits
  sourceImageId: string | null; // 对话结果图编辑：worker 按 owner 重新查询来源 storage key
  credentialMode: "system" | "custom";
  deadlineAt: Date;
  createdAt: Date;
}

/** 后台 worker 标识（写入 generations.job_id，便于追踪是哪个实例抢到）。 */
export function workerTag(): string {
  return `bg-${randomUUID().slice(0, 8)}`;
}

/**
 * 抢占：queued → claimed（单语句原子）。
 * 返回抢到的行；返回 null = 别人抢过/已终态（affected=0），调用方应立即退出（不调中转、不扣费）。
 */
export async function claim(generationId: string, tag: string = workerTag()): Promise<ClaimedGeneration | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE generations SET status='claimed', job_id=${tag}, updated_at=now()
    WHERE id=${generationId} AND status='queued' AND deadline_at>now()
    RETURNING id, user_id, prompt, size, quality, background, input_image_key, source_image_id,
              credential_mode, deadline_at, created_at`;
  if (rows.length === 0) return null;
  return claimedGeneration(rows[0]);
}

/** Short atomic queue claim; no connection/row lock survives the statement. */
export async function claimNext(tag: string = workerTag()): Promise<ClaimedGeneration | null> {
  const sql = getSql();
  if (!usesPgDriver()) {
    // Keep the optional HTTP driver on the existing by-ID compare-and-swap path.
    const rows = await sql`SELECT id FROM generations
      WHERE status='queued' AND deadline_at>now() ORDER BY created_at,id LIMIT 1`;
    return rows.length ? claim(String(rows[0].id), tag) : null;
  }
  const rows = await sql`
    WITH next AS (
      SELECT id FROM generations WHERE status='queued' AND deadline_at>now()
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE generations AS g SET status='claimed',job_id=${tag},updated_at=now()
    FROM next WHERE g.id=next.id AND g.status='queued' AND g.deadline_at>now()
    RETURNING g.id,g.user_id,g.prompt,g.size,g.quality,g.background,g.input_image_key,
              g.source_image_id,g.credential_mode,g.deadline_at,g.created_at`;
  return rows.length ? claimedGeneration(rows[0]) : null;
}

function claimedGeneration(r: Record<string, unknown>): ClaimedGeneration {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    prompt: r.prompt as string,
    size: r.size as string,
    quality: (r.quality as string | null) ?? null,
    background: (r.background as string | null) ?? null,
    inputImageKey: (r.input_image_key as string | null) ?? null,
    sourceImageId: (r.source_image_id as string | null) ?? null,
    credentialMode: r.credential_mode as "system" | "custom",
    deadlineAt: new Date(r.deadline_at as string | Date),
    createdAt: new Date(r.created_at as string | Date),
  };
}

/** 置 running + 写 started_at（抢到后、调中转前）。scheduler 负责超时兜底。 */
export async function markRunning(generationId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`UPDATE generations SET status='running', started_at=now(), updated_at=now()
            WHERE id=${generationId} AND status='claimed' AND deadline_at>now() RETURNING id`;
  return rows.length > 0;
}
