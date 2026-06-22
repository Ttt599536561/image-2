// POST /api/uploads（④b 图生图）。参考图上传 → Supabase uploads/<userId>/… → 返回 inputImageKey。
// requireUserStrict（敏感写·每请求查 DB·封禁拦截）；multipart 单文件 `file`。
// 红线：① 类型以「魔数嗅探」为权威（不信可伪造的 Content-Type，审查 #3）；② 大小双查（声明+实际，≤4MB）；
//       ③ 每用户轻量限流（events 计数，防滥用填桶，审查 #4）。「用后即弃」：不进保留期，靠孤儿清理 cron 回收。
import { getSql } from "../../src/db/db.server";
import { httpError } from "../../src/contracts/error";
import {
  UPLOAD_ACCEPT,
  UPLOAD_EXT,
  UPLOAD_MAX_BYTES,
  type UploadMime,
  sniffImageMime,
} from "../../src/contracts/upload";
import { requireUserStrict } from "../../src/lib/guard";
import { putUserUpload } from "../../src/server/r2.server";
import type { Route } from "./+types/api.uploads";

const UPLOAD_MAX_PER_WINDOW = 40; // 每用户 10 分钟上限（正常 i2i 远不及；挡脚本滥用）

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request); // 抛 Response 401/403
    const sql = getSql();

    // 轻量限流（审查 #4）：近 10min 该用户上传次数（interval 为常量、直接内联）。
    const [rate] = (await sql`
      SELECT COUNT(*)::int AS n FROM events
      WHERE type = 'image_upload' AND user_id = ${ctx.userId}
        AND created_at > now() - interval '10 minutes'`) as Array<{ n: number }>;
    if (Number(rate?.n ?? 0) >= UPLOAD_MAX_PER_WINDOW) {
      return httpError(429, "RATE_LIMITED", "上传太频繁，请稍后再试");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return httpError(400, "INVALID_PARAM", "请求体无效");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return httpError(400, "INVALID_PARAM", "缺少参考图文件");

    // 声明类型快速预筛（仍以下方魔数嗅探为权威）。
    if (!UPLOAD_ACCEPT.includes(file.type as UploadMime)) {
      return httpError(400, "INVALID_PARAM", "仅支持 PNG / JPG / WEBP 图片");
    }
    if (file.size <= 0) return httpError(400, "INVALID_PARAM", "参考图为空");
    if (file.size > UPLOAD_MAX_BYTES) return httpError(400, "INVALID_PARAM", "参考图过大（上限 4MB）");

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return httpError(400, "INVALID_PARAM", "参考图为空");
    if (bytes.byteLength > UPLOAD_MAX_BYTES) {
      return httpError(400, "INVALID_PARAM", "参考图过大（上限 4MB）");
    }

    // 魔数嗅探为权威（审查 #3）：用真实类型决定 ext + ContentType，挡伪造 Content-Type 的存储污染。
    const mime = sniffImageMime(bytes);
    if (!mime) return httpError(400, "INVALID_PARAM", "文件不是有效的 PNG / JPG / WEBP 图片");

    const { storageKey } = await putUserUpload({
      userId: ctx.userId,
      bytes,
      contentType: mime,
      ext: UPLOAD_EXT[mime],
    });

    // 记一次上传（喂限流窗口；不入看板聚合）。
    await sql`INSERT INTO events(type, user_id, payload)
      VALUES('image_upload', ${ctx.userId}, ${JSON.stringify({ bytes: bytes.byteLength, mime })}::jsonb)`;

    return Response.json({ inputImageKey: storageKey });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.uploads] error", e);
    return httpError(500, "INTERNAL", "上传失败，请重试");
  }
}
