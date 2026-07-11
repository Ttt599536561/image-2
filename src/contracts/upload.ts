// 参考图上传契约（④b 图生图）。前后端单一真相源；客户端可达 → 手写 Zod，不引 db/schema。
import { z } from "zod";

// 允许的参考图类型 + 大小上限（前端预校验 + 后端权威校验同值）。
// 4MB 是应用级固定上限；更大图片可在未来改为 presigned 直传。
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_ACCEPT = ["image/png", "image/jpeg", "image/webp"] as const;
export type UploadMime = (typeof UPLOAD_ACCEPT)[number];
// content-type → 文件扩展名（落 key 用）。
export const UPLOAD_EXT: Record<UploadMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * 魔数嗅探（审查 #3）：从字节头判断真实图片类型，**不信可伪造的 Content-Type 声明**。
 * 后端以嗅探结果为权威决定落地 ext/ContentType，堵「声明 image/png 实为任意二进制」的存储污染。
 * 返回白名单内 mime 或 null（非图/不支持）。纯函数、客户端可达安全。
 */
export function sniffImageMime(bytes: Uint8Array): UploadMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png"; // 89 50 4E 47
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg"; // FF D8 FF
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // WEBP
  )
    return "image/webp";
  return null;
}

// 只回 inputImageKey：前端预览走本地 object URL，不需要公链；不回 publicUrl 以收窄暴露面（审查 #8）。
export const UploadResponse = z.object({
  inputImageKey: z.string().min(1).max(300), // uploads/<userId>/… ；回填进 GenerateRequest.inputImageKey
});
export type UploadResponse = z.infer<typeof UploadResponse>;
