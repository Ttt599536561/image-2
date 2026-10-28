// ★server-only：中转调用封装（铁律④：Key 只在此处从 env 注入）。真相源 04 §5.3。
// 复用 v1 imageGeneration.ts 的 build/parse；脱敏复用 redaction.ts。
//
// 🔴 红线：Key 只在服务端注入；模型使用已冻结的允许值，固定 n=1 / moderation=low；
//    AbortError(软超时) 不退避重试（请求已发出、防对中转重复下单）；F-429（HTTP200+error body）守卫；
//    回外层的报错文案先脱敏。

import {
  buildImageGenerationPayload,
  buildImageGenerationUrl,
  type ParsedImage,
  parseImageGenerationResponse,
} from "../api/imageGeneration";
import type { CredentialMode, ErrorCode } from "../contracts/generate";
import { redactText } from "../lib/redaction";
import { getConfigString } from "./config.server";
import { CUSTOM_RELAY_BASE_URL } from "./generation/credential.server";
import { UPLOAD_MAX_BYTES } from "../contracts/upload";
import { DEFAULT_STUDIO_BASE_URL, MAX_STUDIO_REFERENCE_IMAGES, STUDIO_MODEL, STUDIO_MODELS, type StudioModel } from "../contracts/studio";
import { MAX_RELAY_RESPONSE_BYTES, MAX_STUDIO_REQUEST_BYTES, safeHttpsRequest } from "./studio/safe-http.server";

export type RelayCredential = { mode: "system" } | { mode: "custom"; apiKey: string; baseUrl?: string };

export function relayTimeoutMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs - 30_000);
}

// 中转网关（rix）要求 size 为 WIDTHxHEIGHT，不接受「auto」（会回 "size must use WIDTHxHEIGHT…"）。
// 「auto / 比例·智能」档在中转边界落到默认方形；其它档本就是 WxH，原样透传。quality/background 的「auto」中转可接受、不转。
const RELAY_AUTO_SIZE = "1024x1024";
function toRelaySize(size: string): string {
  return size === "auto" || !size ? RELAY_AUTO_SIZE : size;
}

/** 落 R2 的中转图形态（putToR2 入参，06 §7.3）。 */
export type RelayImage = { b64_json?: string; url?: string };

/** 带 HTTP 状态的中转错误（normalizeFailure 据 httpStatus 归一，04 §5.8）。 */
export class RelayError extends Error {
  httpStatus?: number;
  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "RelayError";
    this.httpStatus = httpStatus;
  }
}

// 主/备 Base：主取 app_config.relay_base_url（后台可改、换厂商即时生效），备取 env；
// getConfigString 已对 DB 不可达鲁棒（回退 null）→ 再回退 env（防 relay 因配置读失败全挂）。
async function relayBases(): Promise<string[]> {
  const primary = (await getConfigString("relay_base_url")) || process.env.RELAY_BASE_URL;
  if (!primary) throw new Error("[relay] 缺少 RELAY_BASE_URL（见 .env.example / deploy/.env.production.example）");
  const backup = process.env.RELAY_BASE_URL_BACKUP; // 可空；无备用则只试主
  return backup && backup !== primary ? [primary, backup] : [primary];
}

// 中转 Key：主取 app_config.relay_api_key（后台可改、换厂商即时生效），回退 env RELAY_API_KEY。
// Key 只在 worker 调 relay 前解析并注入 Authorization，绝不下发客户端（后台 GET 也只回 masked）。
async function relayKey(): Promise<string> {
  const key = (await getConfigString("relay_api_key")) || process.env.RELAY_API_KEY;
  if (!key) throw new Error("[relay] 缺少 RELAY_API_KEY（见 .env.example / deploy/.env.production.example）");
  return key;
}

async function relayTarget(
  credential: RelayCredential,
): Promise<{ mode: CredentialMode; key: string; bases: string[] }> {
  if (credential.mode === "custom") {
    if (credential.baseUrl !== undefined && credential.baseUrl !== DEFAULT_STUDIO_BASE_URL) throw new RelayError("图片服务地址无效", 400);
    return { mode: "custom", key: credential.apiKey, bases: [CUSTOM_RELAY_BASE_URL] };
  }
  return { mode: "system", key: await relayKey(), bases: await relayBases() };
}

function sanitizeRelayError(
  error: unknown,
  key: string,
): Error & { httpStatus?: number; failureCode?: ErrorCode } {
  const source = (error ?? {}) as {
    name?: string;
    message?: string;
    httpStatus?: number;
    failureCode?: ErrorCode;
  };
  const safe = new Error(redactText(String(source.message ?? "relay failure"), [key]));
  safe.name = source.name ?? "Error";
  return Object.assign(safe, {
    httpStatus: source.httpStatus,
    failureCode: source.failureCode,
  });
}

// v1 解析输出 {src,kind} → putToR2 入参 {b64_json?,url?}：任意 base64 data URL 提取 b64_json，否则当 url。
// 正则容忍额外 MIME 参数（如 data:image/png;charset=utf-8;base64,…），避免标准外形态把 data URL 漏进 url 分支。
function toRelayImage(p: ParsedImage): RelayImage {
  const m = /^data:[^,]*;base64,(.+)$/.exec(p.src);
  if (m) return { b64_json: m[1] };
  return { url: p.src };
}

function isRetriable(err: unknown): boolean {
  const e = err as { name?: string; httpStatus?: number; message?: string };
  const status = e?.httpStatus;
  return (
    e?.name === "TypeError" ||
    /fetch failed|ECONN|network/i.test(String(e?.message ?? "")) ||
    (status !== undefined && status >= 500)
  );
}

/** 参考图（④b 图生图）：管线回读的字节 + content-type + 文件名（multipart `image` 字段用）。 */
export type RelayInputImage = { bytes: Uint8Array; contentType: string; filename: string };

// 图生图 /images/edits：单图保留 image，多图按官方协议重复 image[]，顺序与字节不变。
// https://developers.openai.com/api/reference/resources/images/methods/edit
// 多图与 sunburst 仅通过本地夹具验收，不表示已验证某个真实上游账户的权限或额度。
// 不设 Content-Type（fetch 按 FormData 自动加 boundary）。每次发送新建（避免流复用问题）。
function buildEditsForm(req: {
  prompt: string;
  model?: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImages: RelayInputImage[];
}): FormData {
  const fd = new FormData();
  fd.append("model", req.model ?? STUDIO_MODEL);
  fd.append("prompt", req.prompt);
  fd.append("size", toRelaySize(req.size));
  fd.append("n", "1");
  // 关键性能：强制内联返回字节（b64_json）。否则中转默认回 us-west aliyuncs 临时 url，
  // putToR2 还要二次下载该跨境 url（实测从国内慢到数分钟、超 5min 轮询窗口 → 前端看不到图）。
  // 实测 relay-edits-probe：带此参 → 200 直接回 b64（~48s）、不带 → 回 url（需慢速下载）。
  fd.append("response_format", "b64_json");
  if (req.quality && req.quality !== "auto") fd.append("quality", req.quality);
  if (req.background && req.background !== "auto") fd.append("background", req.background);
  for (const image of req.inputImages) fd.append(
    req.inputImages.length > 1 ? "image[]" : "image",
    new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
    image.filename,
  );
  return fd;
}

export interface CallRelayRequest {
  prompt: string;
  model?: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImage?: RelayInputImage | null; // ④b：有值 → 走 /images/edits multipart（图生图），无 → JSON 文生图
  inputImages?: RelayInputImage[];
  credential: RelayCredential;
  deadlineAt: Date;
}

function studioProviderError(status: number): RelayError {
  const messages: Record<number, string> = {
    400: "图片服务不支持这些生成参数", 401: "API Key 无效，请检查连接设置",
    403: "图片服务拒绝访问，请检查 API Key 权限", 402: "自定义 API Key 额度不足",
    429: "图片服务请求过于频繁，请稍后重试",
  };
  return new RelayError(messages[status] ?? "图片服务暂时不可用，请稍后重试", status);
}

async function callStudioRelay(req: CallRelayRequest, key: string, jsonBody: string | null, inputImages: RelayInputImage[]): Promise<{ images: RelayImage[] }> {
  const isEdit = inputImages.length > 0;
  const response = await safeHttpsRequest(buildImageGenerationUrl(DEFAULT_STUDIO_BASE_URL, isEdit ? "/images/edits" : undefined), {
    method: "POST",
    headers: isEdit ? { Authorization: `Bearer ${key}` } : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: isEdit ? buildEditsForm({ ...req, inputImages }) : jsonBody!,
    deadlineAtMs: req.deadlineAt.getTime() - 30_000,
    maxResponseBytes: MAX_RELAY_RESPONSE_BYTES,
    maxRequestBytes: MAX_STUDIO_REQUEST_BYTES,
  });
  if (response.status < 200 || response.status >= 300) throw studioProviderError(response.status);
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(response.body.toString("utf8")); }
  catch { throw Object.assign(new Error("图片服务返回的内容无效"), { failureCode: "invalid_response" as const }); }
  if (raw?.error && !raw.data && !raw.output) {
    const status = (raw.error as { status?: unknown }).status;
    throw studioProviderError(typeof status === "number" && status >= 400 && status <= 599 ? status : 502);
  }
  try {
    const images = parseImageGenerationResponse(raw).map(toRelayImage);
    if (!images.length) throw new Error();
    return { images };
  } catch { throw Object.assign(new Error("图片服务未返回有效图片"), { failureCode: "invalid_response" as const }); }
}

export async function callRelay(req: CallRelayRequest): Promise<{ images: RelayImage[] }> {
  if (req.model !== undefined && !STUDIO_MODELS.includes(req.model as StudioModel)) throw new RelayError("模型无效", 400);
  if (req.inputImages !== undefined && req.inputImage) throw new RelayError("来源图片参数冲突", 400);
  const inputImages = req.inputImages ?? (req.inputImage ? [req.inputImage] : []);
  if (!Array.isArray(inputImages) || inputImages.length > MAX_STUDIO_REFERENCE_IMAGES || (req.inputImages && !inputImages.length)) throw new RelayError("参考图数量无效", 400);
  if (inputImages.some((image) => image.bytes.byteLength > UPLOAD_MAX_BYTES)) throw new RelayError("参考图超过 4MiB 限制", 400);
  const { key, bases } = await relayTarget(req.credential);
  if (relayTimeoutMs(req.deadlineAt.getTime()) <= 0) {
    throw new DOMException("provider deadline exceeded", "AbortError");
  }
  const isEdit = inputImages.length > 0;
  const endpoint = isEdit ? "/images/edits" : undefined; // undefined → 默认 /images/generations
  // JSON 文生图 body 不变（一次构造可复用）；图生图 multipart 每次新建（见 buildEditsForm）。
  const jsonBody = isEdit
    ? null
    : JSON.stringify({
        ...buildImageGenerationPayload({
          model: req.model ?? STUDIO_MODEL,
          prompt: req.prompt,
          size: toRelaySize(req.size), // 「auto」→ 1024x1024（中转不接受 auto，见 toRelaySize）
          quality: req.quality ?? "auto",
          background: req.background ?? "auto",
          moderation: "low",
          n: 1, // ★ 固定 n=1 / moderation=low
        }),
        // 关键性能：强制内联 b64（同图生图 buildEditsForm）。实测探测 `scripts/relay-t2i-format-probe.ts`：
        // 默认文生图回 us-west-1 aliyuncs 临时 url → putToR2 需二次下载（且临时链接有过期丢图风险）；
        // 带此参 → 中转 HTTP 200 直接回 b64、免二次下载。
        response_format: "b64_json",
      });

  if (req.credential.mode === "custom" && req.credential.baseUrl !== undefined) {
    // One request only: a timeout or provider failure must never place a second paid order.
    return callStudioRelay(req, key, jsonBody, inputImages);
  }

  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const remainingMs = relayTimeoutMs(req.deadlineAt.getTime());
    if (remainingMs <= 0) throw new DOMException("provider deadline exceeded", "AbortError");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remainingMs);
    try {
      const resp = await fetch(buildImageGenerationUrl(base, endpoint), {
        method: "POST",
        redirect: "error",
        signal: ctrl.signal,
        // 图生图：仅 Authorization，Content-Type 由 FormData 自动设（含 boundary）；文生图：JSON。
        headers: isEdit
          ? { Authorization: `Bearer ${key}` }
          : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: isEdit
          ? buildEditsForm({
              prompt: req.prompt,
              model: req.model,
              size: req.size,
              quality: req.quality,
              background: req.background,
              inputImages,
            })
          : (jsonBody as string),
      });
      if (!resp.ok) {
        const detail = redactText(await resp.text(), [key]); // ★ 脱敏后才外传
        throw new RelayError(detail, resp.status);
      }
      const raw = (await resp.json()) as Record<string, unknown>;
      // ★ F-429：One-API 偶有 HTTP200+error。缺正常字段（data/output）则当上游错误抛出走归一化，
      //   避免把错误体当成功 putToR2。
      if (raw?.error && !raw?.data && !raw?.output) {
        const errObj = raw.error as { status?: number } | undefined;
        const detail = redactText(JSON.stringify(raw.error), [key]);
        throw new RelayError(detail, errObj?.status ?? 200);
      }
      let images: RelayImage[];
      try {
        images = parseImageGenerationResponse(raw).map(toRelayImage);
        if (images.length === 0) throw new Error("provider returned no images");
      } catch (error) {
        throw Object.assign(sanitizeRelayError(error, key), { failureCode: "invalid_response" as const });
      }
      return { images };
    } catch (err) {
      const safeError = sanitizeRelayError(err, key);
      lastErr = safeError;
      const isAbort = safeError.name === "AbortError";
      // AbortError（软超时）= 请求已发出、不知中转是否在跑 → 不退避重试（防重复下单），直接抛走 provider_timeout。
      if (isAbort || !isRetriable(safeError) || i === bases.length - 1) throw safeError;
      await new Promise((r) => setTimeout(r, 500 + i * 500)); // 退避后退到备用 Base 重试一次
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
