// POST /api/generate（同步入队，真相源 04 §5.2）。轻/快/只校验+入队，**绝不 await 中转**。
// requireUserStrict（敏感写·每请求查 DB·封禁拦截）→ enqueue 三闸(402/409/429) → 触发真后台(fire-and-forget) → 202。
import { httpError } from "../../src/contracts/error";
import { GenerateRequest } from "../../src/contracts/generate";
import { requireUserStrict } from "../../src/lib/guard";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { triggerBackground } from "../../src/server/generation/trigger";

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(req); // 抛 Response 401/403
    let input: GenerateRequest;
    try {
      input = GenerateRequest.parse(await req.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    // 三闸 + 建会话 + INSERT generations(queued)（同一 FOR UPDATE 事务）；抛 Response 402/409/429/404。
    const { generationId, conversationId } = await enqueueGeneration({
      user: { id: ctx.userId, maxConcurrency: ctx.maxConcurrency },
      input,
    });
    await triggerBackground(generationId); // fire-and-forget（不抛、不阻塞）
    // conversationId 回前端：首次提交在 "/" 入队后据此 navigate(/c/:id)（08 §9.2）。
    return Response.json({ generationId, conversationId, status: "queued" }, { status: 202 });
  } catch (e) {
    if (e instanceof Response) return e; // guard / enqueue 抛出的统一错误信封
    console.error("[generate] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
