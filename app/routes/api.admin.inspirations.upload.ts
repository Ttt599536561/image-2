// POST /api/admin/inspirations/upload（灵感封面本地上传，multipart 单文件 `file`）。
// 双守卫之一：requireAdmin（每请求查 DB role + 未封禁）。落 inspirations/<uuid> → 返回公有 URL。
// 🔴 红线：① 类型以「魔数嗅探」为权威（不信可伪造的 Content-Type）；② 大小双查（声明+实际，≤4MB，留 Netlify 6MB body 余量）。
import { httpError } from "../../src/contracts/error";
import {
  UPLOAD_ACCEPT,
  UPLOAD_EXT,
  UPLOAD_MAX_BYTES,
  type UploadMime,
  sniffImageMime,
} from "../../src/contracts/upload";
import { requireAdmin } from "../../src/lib/guard";
import { putInspirationCover } from "../../src/server/r2.server";
import type { Route } from "./+types/api.admin.inspirations.upload";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    await requireAdmin(request); // 抛 Response 401/403

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return httpError(400, "INVALID_PARAM", "请求体无效");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return httpError(400, "INVALID_PARAM", "缺少图片文件");

    // 声明类型快速预筛（仍以下方魔数嗅探为权威）。
    if (!UPLOAD_ACCEPT.includes(file.type as UploadMime)) {
      return httpError(400, "INVALID_PARAM", "仅支持 PNG / JPG / WEBP 图片");
    }
    if (file.size <= 0) return httpError(400, "INVALID_PARAM", "图片为空");
    if (file.size > UPLOAD_MAX_BYTES) return httpError(400, "INVALID_PARAM", "图片过大（上限 4MB）");

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return httpError(400, "INVALID_PARAM", "图片为空");
    if (bytes.byteLength > UPLOAD_MAX_BYTES) return httpError(400, "INVALID_PARAM", "图片过大（上限 4MB）");

    // 魔数嗅探为权威：用真实类型决定 ext + ContentType，挡伪造 Content-Type 的存储污染。
    const mime = sniffImageMime(bytes);
    if (!mime) return httpError(400, "INVALID_PARAM", "文件不是有效的 PNG / JPG / WEBP 图片");

    const { publicUrl } = await putInspirationCover({ bytes, contentType: mime, ext: UPLOAD_EXT[mime] });
    return Response.json({ coverUrl: publicUrl });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.inspirations.upload] error", e);
    return httpError(500, "INTERNAL", "上传失败，请重试");
  }
}
