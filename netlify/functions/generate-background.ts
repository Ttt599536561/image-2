// Background Function（**-background 后缀 = Netlify 异步派发、15min、平台会自动重试**，真相源 04 §5.3）。
// 内部触发（无鉴权），body 仅 {generationId} → runGenerationJob（抢占→中转→落图→扣费；幂等、可重试）。
// 正因平台会重试，runGenerationJob 入口的抢占式状态机（铁律③）+ 扣费 ⓪双守卫挡重复下单/扣费。
import { runGenerationJob } from "../../src/server/generation/process";

export default async function handler(req: Request): Promise<Response> {
  try {
    const { generationId } = (await req.json().catch(() => ({}))) as { generationId?: string };
    if (!generationId) return Response.json({ error: "missing generationId" }, { status: 400 });
    const outcome = await runGenerationJob(generationId);
    return Response.json({ ok: true, outcome }, { status: 202 });
  } catch {
    console.error("[generate-background] internal failure");
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
