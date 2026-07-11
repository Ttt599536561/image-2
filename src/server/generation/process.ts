// ★server-only：后台生图编排（真相源 04 §5.3）。持久 worker 调用它。
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
import { RelayError, callRelay as realCallRelay, type RelayCredential } from "../relay";
import { deleteGenerationCredential, loadCustomApiKey } from "./credential.server";
import { normalizeFailure } from "./failure";
import { finalizeCustomSuccess } from "./finalizeCustom.server";

export interface ProcessDeps {
  callRelay?: typeof realCallRelay;
  putToR2?: typeof realPutToR2;
  getUploadObject?: typeof realGetUploadObject; // ④b：回读参考图字节（测试可桩，免烧 Supabase）
}

export type ProcessOutcome = "lost" | "budget_exhausted" | "succeeded" | "failed";

/**
 * 消费单个 generation（幂等，可被 worker 重领或 scheduler 重扫多次安全调用）。
 * 返回结果供 worker、兼容 handler、测试和日志判别。
 */
export async function runGenerationJob(generationId: string, deps: ProcessDeps = {}): Promise<ProcessOutcome> {
  const callRelay = deps.callRelay ?? realCallRelay;
  const putToR2 = deps.putToR2 ?? realPutToR2;
  const getUploadObject = deps.getUploadObject ?? realGetUploadObject;
  const sql = getSql();

  // ① 抢占（铁律③）：queued→claimed。抢不到（重试/重扫/已终态）→ 立即退，不调中转、不扣费。
  const g = await claim(generationId);
  if (!g) return "lost";

  // ② running + started_at；scheduler 使用 deadline_at 做权威超时收口。
  await markRunning(generationId);

  const t0 = Date.now();
  let credential: RelayCredential = { mode: "system" };
  try {
    if (g.credentialMode === "custom") {
      credential = { mode: "custom", apiKey: await loadCustomApiKey(generationId) };
    }

    // 只有 system 消耗本站共享中转预算；custom 使用用户自己的凭据和固定目标。
    if (g.credentialMode === "system" && !(await incCallIfUnderCap())) {
      if (await markBudgetAlertedOnce()) {
        await alert("daily_budget_exhausted", {
          exhausted: true,
          reason: "hard_cap_hit",
          source: "generation",
          generationId,
        });
      }
      await sql`
        UPDATE generations SET status='failed', error_code='insufficient_quota', error='今日额度已满，请稍后',
          completed_at=now(), duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
        WHERE id=${generationId} AND status='running'`;
      return "budget_exhausted";
    }

    // ④b 图生图：有参考图 key → 回读字节，传给 callRelay 走 /images/edits multipart（无则文生图）。
    // 回读失败（参考图已被孤儿清理/存储故障，罕见）→ 友好归一为 invalid_request、不扣费（在扣费事务前）。
    let inputImage: Awaited<ReturnType<typeof realGetUploadObject>> | null = null;
    let fetchInputMs = 0;
    if (g.inputImageKey) {
      const tf = Date.now();
      try {
        inputImage = await getUploadObject(g.inputImageKey);
      } catch {
        throw new RelayError("参考图已失效，请重新上传后再试", 400);
      }
      fetchInputMs = Date.now() - tf;
    }

    // ④ 调中转（Key 只在此从 env 注入；固定 gpt-image-2/n=1/moderation=low）。
    const tRelay = Date.now();
    const { images } = await callRelay({
      prompt: g.prompt,
      size: g.size,
      quality: g.quality,
      background: g.background,
      inputImage,
      credential,
      deadlineAt: g.deadlineAt,
    });
    const relayMs = Date.now() - tRelay;
    if (!images.length) {
      throw Object.assign(new Error("中转响应无有效图片"), { failureCode: "invalid_response" as const });
    }

    // ⑤ 落 R2（事务外，结果存临时变量）。
    const tPut = Date.now();
    let obj: Awaited<ReturnType<typeof realPutToR2>>;
    try {
      obj = await putToR2(g.userId, generationId, images[0]);
    } catch {
      throw Object.assign(new Error("图片保存失败，本站未扣积分，请重试"), {
        failureCode: "storage_failed" as const,
      });
    }
    const putMs = Date.now() - tPut;
    // 可观测：每张图的耗时拆分（定位瓶颈在中转响应还是落图上传；本机跨境会偏大，线上美西机房快）。
    console.log(
      `[gen-timing] ${generationId} ${g.inputImageKey ? "i2i" : "t2i"} fetchInput=${fetchInputMs}ms relay=${relayMs}ms putToR2=${putMs}ms total=${Date.now() - t0}ms`,
    );

    const finalizeInput = {
      generationId,
      userId: g.userId,
      storageKey: obj.storageKey,
      publicUrl: obj.publicUrl,
      contentType: obj.contentType,
      width: obj.width ?? null,
      height: obj.height ?? null,
      sizeBytes: obj.sizeBytes,
    };
    if (g.credentialMode === "custom") {
      return (await finalizeCustomSuccess(finalizeInput)) === "succeeded" ? "succeeded" : "lost";
    }
    const charged = await chargeOnSuccess(finalizeInput);
    return charged.outcome === "not_running" ? "lost" : "succeeded";
  } catch (err) {
    // ⑦ 失败/超时：脱敏归一后写 failed，不进扣费事务（天然未扣）。
    const secrets = credential.mode === "custom" ? [credential.apiKey] : [];
    const { code, message, httpStatus } = normalizeFailure(err, {
      mode: g.credentialMode,
      secrets,
    });
    const updated = await sql`
      UPDATE generations SET status='failed', error_code=${code}, error=${message},
        http_status=${httpStatus ?? null}, completed_at=now(),
        duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
      WHERE id=${generationId} AND status='running' RETURNING id`;
    if (updated.length > 0) {
      await sql`INSERT INTO events(type,user_id,payload)
                VALUES('image_failed',${g.userId},${JSON.stringify({ generationId, reason: code, credentialMode: g.credentialMode })}::jsonb)`;
    }
    return updated.length > 0 ? "failed" : "lost";
  } finally {
    if (g.credentialMode === "custom") await deleteGenerationCredential(generationId);
    else await incMs(Date.now() - t0);
  }
}
