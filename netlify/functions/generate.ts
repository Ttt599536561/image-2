// POST /api/generate（同步入队，真相源 04 §5.2）。轻/快/只校验+入队，**绝不 await 中转**。
// requireUserStrict（敏感写·每请求查 DB·封禁拦截）→ enqueue 三闸(402/409/429) → 202；Docker worker 持续消费队列。
import { httpError } from "../../src/contracts/error";
import { GenerateRequest, generateRequestErrorCode } from "../../src/contracts/generate";
import { requireUserStrict } from "../../src/lib/guard";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { isCustomKeyModesEnabled } from "../../src/server/generation/feature.server";

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(req); // 抛 Response 401/403
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return httpError(400, "INVALID_PARAM", "请求体无效");
    }
    const parsed = GenerateRequest.safeParse(body);
    if (!parsed.success) {
      const code = generateRequestErrorCode(parsed.error);
      if (code === "CUSTOM_KEY_REQUIRED") {
        return httpError(400, code, "请先填写并保存自定义 Key");
      }
      if (code === "SYSTEM_MODE_FORBIDS_CUSTOM_KEY") {
        return httpError(400, code, "系统 Key 模式不接受自定义 Key");
      }
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const input = parsed.data;
    if (input.credentialMode === "custom" && !isCustomKeyModesEnabled()) {
      return httpError(503, "CUSTOM_KEY_MODES_DISABLED", "自定义 Key 暂停使用，请切换系统 Key 或稍后重试");
    }
    // 三闸 + 建会话 + INSERT generations(queued)（同一 FOR UPDATE 事务）；抛 Response 402/409/429/404。
    const accepted = await enqueueGeneration({
      user: { id: ctx.userId, maxConcurrency: ctx.maxConcurrency },
      input,
    });
    // conversationId 回前端：首次提交在 "/" 入队后据此 navigate(/c/:id)（08 §9.2）。
    return Response.json({ ...accepted, status: "queued" }, { status: 202 });
  } catch (e) {
    if (e instanceof Response) return e; // guard / enqueue 抛出的统一错误信封
    console.error("[generate] internal error");
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
