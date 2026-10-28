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
import { claim, claimNext, markRunning, type ClaimedGeneration } from "../money/preempt.server";
import {
  getStoredImageObject as realGetStoredImageObject,
  getUploadObject as realGetUploadObject,
  putToR2 as realPutToR2,
} from "../r2.server";
import { RelayError, callRelay as realCallRelay, type RelayCredential } from "../relay";
import { deleteGenerationCredential, loadCustomCredential } from "./credential.server";
import { normalizeFailure } from "./failure";
import { finalizeCustomSuccess } from "./finalizeCustom.server";

export interface ProcessDeps {
  callRelay?: typeof realCallRelay;
  putToR2?: typeof realPutToR2;
  getUploadObject?: typeof realGetUploadObject; // ④b：回读参考图字节（测试可桩，免烧 Supabase）
  getStoredImageObject?: typeof realGetStoredImageObject; // 对话编辑：只读 DB 中权威 storage key
}

export type ProcessOutcome = "lost" | "budget_exhausted" | "succeeded" | "failed";

function sourceImageUnavailable(): Error & { failureCode: "source_image_unavailable" } {
  return Object.assign(new Error("这张图片已不可编辑"), {
    failureCode: "source_image_unavailable" as const,
  });
}

function diagnostic(generationId: string, stage: string): void {
  try { console.warn(`[generation] ${generationId} ${stage}`); } catch { /* best effort */ }
}

/**
 * 消费单个 generation（幂等，可被 worker 重领或 scheduler 重扫多次安全调用）。
 * 返回结果供 worker、兼容 handler、测试和日志判别。
 */
export async function runGenerationJob(generationId: string, deps: ProcessDeps = {}): Promise<ProcessOutcome> {
  const tClaim = Date.now();
  const g = await claim(generationId);
  return g ? processClaimedGeneration(g, deps, Date.now() - tClaim) : "lost";
}

/** Only return work that this consumer has atomically claimed. */
export async function startNextGenerationJob(deps: ProcessDeps = {}): Promise<{ completion: Promise<ProcessOutcome> } | null> {
  const tClaim = Date.now();
  const g = await claimNext();
  return g ? { completion: processClaimedGeneration(g, deps, Date.now() - tClaim) } : null;
}

async function processClaimedGeneration(g: ClaimedGeneration, deps: ProcessDeps, claimMs: number): Promise<ProcessOutcome> {
  const generationId = g.id;
  const callRelay = deps.callRelay ?? realCallRelay;
  const putToR2 = deps.putToR2 ?? realPutToR2;
  const getUploadObject = deps.getUploadObject ?? realGetUploadObject;
  const getStoredImageObject = deps.getStoredImageObject ?? realGetStoredImageObject;
  const sql = getSql();

  const t0 = Date.now();
  const timings = { claimMs, queueWaitMs: Math.max(0, t0 - g.createdAt.getTime()), fetchInputMs: 0, relayMs: 0, storageMs: 0, settlementMs: 0 };
  const timed = async <T>(phase: "fetchInputMs" | "relayMs" | "storageMs" | "settlementMs", operation: () => Promise<T>) => {
    const started = Date.now();
    try { return await operation(); } finally { timings[phase] += Date.now() - started; }
  };
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("generation deadline exceeded", "AbortError"));
  const timer = setTimeout(abort, Math.max(0, g.deadlineAt.getTime() - Date.now()));
  const checkDeadline = () => {
    if (Date.now() >= g.deadlineAt.getTime()) abort();
    controller.signal.throwIfAborted();
  };
  let outcome: ProcessOutcome = "lost";
  let credential: RelayCredential = { mode: "system" };
  try {
    // Lost/expired claims must not reach Relay. Scheduler remains the crash recovery owner.
    if (!(await markRunning(generationId))) return outcome;
    checkDeadline();
    if (g.credentialMode === "custom") {
      credential = await loadCustomCredential(generationId);
    }

    let inputImage: Awaited<ReturnType<typeof realGetUploadObject>> | null = null;
    if (g.inputImageKey && g.sourceImageId) throw sourceImageUnavailable();
    if (g.sourceImageId) {
      const [source] = await sql`
        SELECT i.storage_key
          FROM images i
          JOIN generations sg ON sg.id=i.generation_id
         WHERE i.id=${g.sourceImageId} AND i.user_id=${g.userId}
           AND sg.user_id=${g.userId} AND sg.status='succeeded'`;
      if (!source) throw sourceImageUnavailable();
      try {
        inputImage = await timed("fetchInputMs", () => getStoredImageObject(String(source.storage_key), controller.signal));
        checkDeadline();
      } catch {
        checkDeadline();
        throw sourceImageUnavailable();
      }
    }

    // 只有 system 消耗本站共享中转预算；custom 使用任务冻结的用户凭据和目标。
    if (g.credentialMode === "system" && !(await incCallIfUnderCap())) {
      try {
        if (await markBudgetAlertedOnce()) await alert("daily_budget_exhausted", {
          exhausted: true,
          reason: "hard_cap_hit",
          source: "generation",
          generationId,
        });
      } catch { diagnostic(generationId, "budget_alert_failed"); }
      await sql`
        UPDATE generations SET status='failed', error_code='insufficient_quota', error='今日额度已满，请稍后',
          completed_at=now(), duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
        WHERE id=${generationId} AND status='running'`;
      return outcome = "budget_exhausted";
    }

    // ④b 图生图：有参考图 key → 回读字节，传给 callRelay 走 /images/edits multipart（无则文生图）。
    // 回读失败（参考图已被孤儿清理/存储故障，罕见）→ 友好归一为 invalid_request、不扣费（在扣费事务前）。
    if (g.inputImageKey) {
      try {
        inputImage = await timed("fetchInputMs", () => getUploadObject(g.inputImageKey!, controller.signal));
        checkDeadline();
      } catch {
        checkDeadline();
        throw new RelayError("参考图已失效，请重新上传后再试", 400);
      }
    }

    // ④ 调中转（Key 只在此从 env 注入；固定 gpt-image-2/n=1/moderation=low）。
    checkDeadline();
    const { images } = await timed("relayMs", () => callRelay({
      prompt: g.prompt,
      size: g.size,
      quality: g.quality,
      background: g.background,
      inputImage,
      credential,
      deadlineAt: g.deadlineAt,
    }));
    checkDeadline();
    if (!images.length) {
      throw Object.assign(new Error("中转响应无有效图片"), { failureCode: "invalid_response" as const });
    }

    // ⑤ 落 R2（事务外，结果存临时变量）。
    let obj: Awaited<ReturnType<typeof realPutToR2>>;
    try {
      obj = await timed("storageMs", () => putToR2(g.userId, generationId, images[0], controller.signal));
      checkDeadline();
    } catch {
      checkDeadline();
      throw Object.assign(new Error("图片保存失败，本站未扣积分，请重试"), {
        failureCode: "storage_failed" as const,
      });
    }

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
      return outcome = (await timed("settlementMs", () => finalizeCustomSuccess(finalizeInput))) === "succeeded" ? "succeeded" : "lost";
    }
    const charged = await timed("settlementMs", () => chargeOnSuccess(finalizeInput));
    return outcome = charged.outcome === "not_running" ? "lost" : "succeeded";
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
      try { await sql`INSERT INTO events(type,user_id,payload)
                VALUES('image_failed',${g.userId},${JSON.stringify({ generationId, reason: code, credentialMode: g.credentialMode })}::jsonb)`;
      } catch { diagnostic(generationId, "failure_event_failed"); }
    }
    return outcome = updated.length > 0 ? "failed" : "lost";
  } finally {
    clearTimeout(timer);
    try {
      console.log(`[gen-timing] ${JSON.stringify({ generationId, ...timings, totalMs: Date.now() - t0, endToEndMs: Date.now() - g.createdAt.getTime(), outcome })}`);
    } catch { /* timing must never change settlement */ }
    try {
      if (g.credentialMode === "custom") await deleteGenerationCredential(generationId);
      else await incMs(Date.now() - t0);
    } catch {
      diagnostic(generationId, g.credentialMode === "custom" ? "credential_cleanup_failed" : "budget_metrics_failed");
    }
  }
}
