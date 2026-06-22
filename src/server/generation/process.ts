// ★server-only：后台生图编排（真相源 04 §5.3）。Background Function 入口调它。
// 抢占(铁律③) → running → 预算硬闸(调中转前) → callRelay → putToR2(事务外) → 扣费(成功才扣) → 终态。
// 失败/超时归一为 failed，从不进扣费事务（天然未扣）；finally 累计 ms（仅监控）。
//
// 🔴 红线：claim 是第一步、affected=0 立即退；预算硬闸在 callRelay「前」；putToR2 在扣费事务外；
//    失败不扣费；duration_ms 用 (EXTRACT(EPOCH…)*1000)::int；callRelay/putToR2 可注入（测试桩，免烧中转/Supabase）。
import { getSql } from "../../db/db.server";
import { alert } from "../alert.server";
import { incCallIfUnderCap, incMs, markBudgetAlertedOnce } from "../budget.server";
import { chargeOnSuccess } from "../money/debit.server";
import { claim, markRunning } from "../money/preempt.server";
import { getUploadObject as realGetUploadObject, putToR2 as realPutToR2 } from "../r2.server";
import { RelayError, callRelay as realCallRelay } from "../relay";
import { normalizeFailure } from "./failure";

export interface ProcessDeps {
  callRelay?: typeof realCallRelay;
  putToR2?: typeof realPutToR2;
  getUploadObject?: typeof realGetUploadObject; // ④b：回读参考图字节（测试可桩，免烧 Supabase）
}

export type ProcessOutcome = "lost" | "budget_exhausted" | "succeeded" | "failed";

/**
 * 消费单个 generation（幂等、可被平台重试/重扫多次安全调用）。
 * 返回结果仅供测试/日志判别；HTTP 后台函数忽略返回值。
 */
export async function runGenerationJob(generationId: string, deps: ProcessDeps = {}): Promise<ProcessOutcome> {
  const callRelay = deps.callRelay ?? realCallRelay;
  const putToR2 = deps.putToR2 ?? realPutToR2;
  const getUploadObject = deps.getUploadObject ?? realGetUploadObject;
  const sql = getSql();

  // ① 抢占（铁律③）：queued→claimed。抢不到（重试/重扫/已终态）→ 立即退，不调中转、不扣费。
  const g = await claim(generationId);
  if (!g) return "lost";

  // ② running + started_at（超时 cron 以 COALESCE(started_at,updated_at) 兜底）。
  await markRunning(generationId);

  // ③ 预算硬上限（铁律①·防破产）：与「calls+1」同一原子语句、调中转前。affected=0 → 不调中转、置 failed。
  if (!(await incCallIfUnderCap())) {
    // 「命中即告警」（铁律①·10 §11.9 daily_budget_exhausted「每天首次」）：防破产硬上限被击中=当天敞口见顶，
    // 站长必须当场收到。markBudgetAlertedOnce 原子去重（每天首次才发）；alert 永不抛，可安全 await。
    if (await markBudgetAlertedOnce()) {
      await alert("daily_budget_exhausted", { exhausted: true, reason: "hard_cap_hit", source: "generation", generationId });
    }
    await sql`
      UPDATE generations SET status='failed', error_code='insufficient_quota', error='今日额度已满，请稍后',
        completed_at=now(), duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
      WHERE id=${generationId} AND status='running'`;
    return "budget_exhausted";
  }

  const t0 = Date.now();
  try {
    // ④b 图生图：有参考图 key → 回读字节，传给 callRelay 走 /images/edits multipart（无则文生图）。
    // 回读失败（参考图已被孤儿清理/存储故障，罕见）→ 友好归一为 invalid_request、不扣费（在扣费事务前）。
    let inputImage: Awaited<ReturnType<typeof realGetUploadObject>> | null = null;
    if (g.inputImageKey) {
      try {
        inputImage = await getUploadObject(g.inputImageKey);
      } catch {
        throw new RelayError("参考图已失效，请重新上传后再试", 400);
      }
    }

    // ④ 调中转（Key 只在此从 env 注入；固定 gpt-image-2/n=1/moderation=low）。
    const { images } = await callRelay({
      prompt: g.prompt,
      size: g.size,
      quality: g.quality,
      background: g.background,
      inputImage,
    });
    if (!images.length) throw new Error("中转返回 0 张图");

    // ⑤ 落 R2（事务外，结果存临时变量）。
    const obj = await putToR2(g.userId, generationId, images[0]);

    // ⑥ 扣费事务（成功才扣 + ⓪双守卫 + 幂等）→ 内部置 succeeded。
    await chargeOnSuccess({
      generationId,
      userId: g.userId,
      storageKey: obj.storageKey,
      publicUrl: obj.publicUrl,
      contentType: obj.contentType,
      width: obj.width ?? null,
      height: obj.height ?? null,
      sizeBytes: obj.sizeBytes,
    });
    return "succeeded";
  } catch (err) {
    // ⑦ 失败/超时：脱敏归一后写 failed，不进扣费事务（天然未扣）。
    const { code, message, httpStatus } = normalizeFailure(err);
    await sql`
      UPDATE generations SET status='failed', error_code=${code}, error=${message},
        http_status=${httpStatus ?? null}, completed_at=now(),
        duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
      WHERE id=${generationId} AND status='running'`;
    return "failed";
  } finally {
    // ⑧ ms 累计（仅监控/告警，不硬挡；被平台杀少计由 10 §11.8 cron 重算覆盖）。
    await incMs(Date.now() - t0);
  }
}
