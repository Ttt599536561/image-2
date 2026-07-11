// ★server-only：DB 计数窗口限流（07 §8.6）。阶段二轻量、无 Redis；阶段三规模化再迁 KV。
// 只计**失败**尝试；按 IP + 主体（账号/邮箱）双维度，任一维度命中即限流（取更严者）。
// 失败事件 type='rate_fail' 写 events（不入看板聚合）；redeem/sign-in/sign-up 统一收口于此。
import { getSql } from "../db/db.server";

export type RateKind = "redeem" | "sign_in" | "sign_up";

interface Rule {
  windowSec: number;
  max: number;
}

// 阈值（07 §8.6）：redeem 5/10min、sign-in 10/10min、sign-up 5/小时。
const RULES: Record<RateKind, Rule> = {
  redeem: { windowSec: 600, max: 5 },
  sign_in: { windowSec: 600, max: 10 },
  sign_up: { windowSec: 3600, max: 5 },
};

const EVENT_TYPE = "rate_fail";

export interface RateDims {
  ip: string | null;
  subject: string | null; // 账号 id / 邮箱（按 IP-only 限流时传 null）
}

/** 近窗口内失败数 ≥ 阈值 → true（命中）。任一维度（IP / subject）超阈即命中。 */
export async function isRateLimited(kind: RateKind, dims: RateDims): Promise<boolean> {
  const { windowSec, max } = RULES[kind];
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM events
    WHERE type = ${EVENT_TYPE}
      AND payload->>'kind' = ${kind}
      AND created_at > now() - (${windowSec}::int * interval '1 second')
      AND (
        (${dims.ip}::text IS NOT NULL AND payload->>'ip' = ${dims.ip})
        OR (${dims.subject}::text IS NOT NULL AND payload->>'subject' = ${dims.subject})
      )`;
  return Number(rows[0].n) >= max;
}

/** 记一次失败尝试（核销/登录/注册失败后调用，喂限流窗口）。 */
export async function recordRateFailure(kind: RateKind, dims: RateDims): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO events(type, payload)
    VALUES(${EVENT_TYPE}, ${JSON.stringify({ kind, ip: dims.ip, subject: dims.subject })}::jsonb)`;
}

/** 仅在显式信任 Caddy 时读取 x-forwarded-for 首段。 */
export function clientIp(request: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.TRUST_PROXY !== "true") return null;
  const h = request.headers;
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
