// ★server-only：数据看板（09 §10.7）。三口径分工：① 余额/负债查 credit_lots ② 资金流水/历史走 events
// ③ 运维实时/失败口径查 generations（失败无 image_failed 事件→必查 generations）。
// 🔴 所有 SUM 走 string codec（sumStr，避免 number 截断把钱算错）；count/avg 用 number。
import { getSql } from "../../db/db.server";
import { sumStr, toInt } from "../sumCodec";

type Row = Record<string, unknown>;

/** 今日起点（Asia/Shanghai 午夜的 UTC 时刻，与预算 date-in-key 同区，无 DST）。 */
function shanghaiTodayStartIso(now = new Date()): string {
  const sh = new Date(now.getTime() + 8 * 3_600_000); // 偏移到上海挂钟（用 UTC 字段读）
  const midnightUtcMs = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), 0, 0, 0) - 8 * 3_600_000;
  return new Date(midnightUtcMs).toISOString();
}

export interface Dashboard {
  todayRegistrations: number;
  totalImages: number; // 累计成功图（events，survive 清理）
  todaySucceeded: number;
  todayFailed: number;
  failedTop: { code: string; count: number }[]; // 今日失败原因排行（归一化六值）
  todayRevenueCash: string; // 面值现金（分），展示 /100
  totalRevenueCash: string;
  grantedMp: string; // 累计发放
  consumedMp: string; // 累计消耗
  liabilityMp: string; // 账面负债=未过期 remaining 之和
  queueQueued: number;
  queueRunning: number;
  avgDurationMs: number;
  sizeBreakdown: { size: string; count: number }[];
  totalUsers: number;
  paidUsers: number;
}

export async function loadDashboard(): Promise<Dashboard> {
  const sql = getSql();
  const day = shanghaiTodayStartIso();

  const [
    evToday,
    evCumulative,
    liability,
    genToday,
    failedTop,
    queue,
    avg,
    sizes,
    users,
  ] = await Promise.all([
    sql`SELECT
          count(*) FILTER (WHERE type='user_registered') AS reg,
          COALESCE(sum((payload->>'cashValue')::bigint) FILTER (WHERE type='code_redeemed'),0)::text AS revenue
        FROM events WHERE created_at >= ${day}::timestamptz` as Promise<Row[]>,
    // 🔴 消耗口径修正（对抗审查 major）：生图扣费走 image_succeeded(payload.creditsChargedMp)，
    //   非 credit_consumed（后者仅 adjust 减额发）。累计消耗 = 生图扣费 + 管理员减额，二者皆 outflow。
    sql`SELECT
          count(*) FILTER (WHERE type='image_succeeded') AS total_images,
          COALESCE(sum((payload->>'cashValue')::bigint) FILTER (WHERE type='code_redeemed'),0)::text AS total_revenue,
          COALESCE(sum((payload->>'amountMp')::bigint) FILTER (WHERE type='credit_granted'),0)::text AS granted,
          (COALESCE(sum((payload->>'creditsChargedMp')::bigint) FILTER (WHERE type='image_succeeded'),0)
           + COALESCE(sum((payload->>'amountMp')::bigint) FILTER (WHERE type='credit_consumed'),0))::text AS consumed
        FROM events` as Promise<Row[]>,
    sql`SELECT COALESCE(sum(remaining_mp),0)::text AS s FROM credit_lots
        WHERE remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())` as Promise<Row[]>,
    sql`SELECT
          count(*) FILTER (WHERE status='succeeded') AS ok,
          count(*) FILTER (WHERE status='failed')    AS fail
        FROM generations WHERE created_at >= ${day}::timestamptz` as Promise<Row[]>,
    sql`SELECT error_code AS code, count(*)::int AS n FROM generations
        WHERE status='failed' AND created_at >= ${day}::timestamptz AND error_code IS NOT NULL
        GROUP BY error_code ORDER BY n DESC LIMIT 6` as Promise<Row[]>,
    sql`SELECT
          count(*) FILTER (WHERE status='queued') AS queued,
          count(*) FILTER (WHERE status IN ('claimed','running')) AS running
        FROM generations` as Promise<Row[]>,
    sql`SELECT COALESCE(avg(duration_ms),0)::int AS ms FROM generations WHERE status='succeeded' AND duration_ms IS NOT NULL` as Promise<Row[]>,
    sql`SELECT size, count(*)::int AS n FROM generations WHERE status='succeeded' GROUP BY size ORDER BY n DESC` as Promise<Row[]>,
    sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE has_paid)::int AS paid FROM users` as Promise<Row[]>,
  ]);

  return {
    todayRegistrations: toInt(evToday[0]?.reg),
    totalImages: toInt(evCumulative[0]?.total_images),
    todaySucceeded: toInt(genToday[0]?.ok),
    todayFailed: toInt(genToday[0]?.fail),
    failedTop: failedTop.map((r) => ({ code: r.code as string, count: toInt(r.n) })),
    todayRevenueCash: sumStr(evToday[0]?.revenue),
    totalRevenueCash: sumStr(evCumulative[0]?.total_revenue),
    grantedMp: sumStr(evCumulative[0]?.granted),
    consumedMp: sumStr(evCumulative[0]?.consumed),
    liabilityMp: sumStr(liability[0]?.s),
    queueQueued: toInt(queue[0]?.queued),
    queueRunning: toInt(queue[0]?.running),
    avgDurationMs: toInt(avg[0]?.ms),
    sizeBreakdown: sizes.map((r) => ({ size: r.size as string, count: toInt(r.n) })),
    totalUsers: toInt(users[0]?.total),
    paidUsers: toInt(users[0]?.paid),
  };
}
