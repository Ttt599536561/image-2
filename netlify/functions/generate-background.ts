// Legacy Netlify/disposable compatibility wrapper. Docker uses the persistent worker directly.
// body 仅 {generationId} → runGenerationJob；抢占状态机与扣费双守卫保证重入安全。
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
