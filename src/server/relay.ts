// ★server-only：中转调用封装（铁律④：Key 只在此处从 env 注入）。真相源 04 §5.3。
// 复用 v1 imageGeneration.ts 的 build/parse；脱敏复用 redaction.ts。
//
// 🔴 红线：Key 只从 process.env.RELAY_API_KEY；固定 model=gpt-image-2 / n=1 / moderation=low；
//    AbortError(软超时) 不退避重试（请求已发出、防对中转重复下单）；F-429（HTTP200+error body）守卫；
//    回外层的报错文案先脱敏。

import {
  buildImageGenerationPayload,
  buildImageGenerationUrl,
  type ParsedImage,
  parseImageGenerationResponse,
} from "../api/imageGeneration";
import { redactText } from "../lib/redaction";
import { getConfigString } from "./config.server";

const RELAY_SOFT_TIMEOUT_MS = 4.5 * 60_000; // 略小于 cron 5min，本函数自归一化 provider_timeout（F-relay）

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
  if (!primary) throw new Error("[relay] 缺少 RELAY_BASE_URL（见 PHASE2-PLAN §0）");
  const backup = process.env.RELAY_BASE_URL_BACKUP; // 可空；无备用则只试主
  return backup && backup !== primary ? [primary, backup] : [primary];
}

// 中转 Key：主取 app_config.relay_api_key（后台可改、换厂商即时生效），回退 env RELAY_API_KEY。
// ★ Key 只在 Background Function 内解析、注入 Authorization，绝不下发客户端（后台 GET 也只回 masked）。
async function relayKey(): Promise<string> {
  const key = (await getConfigString("relay_api_key")) || process.env.RELAY_API_KEY;
  if (!key) throw new Error("[relay] 缺少 RELAY_API_KEY（见 PHASE2-PLAN §0）");
  return key;
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

// 图生图 multipart body（gpt-image-2 /images/edits）。字段集 model/prompt/size/n/image + 非「auto」的
// quality/background 均经 ④a 探测实测中转 200 接受（relay-edits-probe.ts 含 quality=high+background=opaque 一组）。
// 不设 Content-Type（fetch 按 FormData 自动加 boundary）。每次发送新建（避免流复用问题）。
function buildEditsForm(req: {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImage: RelayInputImage;
}): FormData {
  const fd = new FormData();
  fd.append("model", "gpt-image-2");
  fd.append("prompt", req.prompt);
  fd.append("size", toRelaySize(req.size));
  fd.append("n", "1");
  // 关键性能：强制内联返回字节（b64_json）。否则中转默认回 us-west aliyuncs 临时 url，
  // putToR2 还要二次下载该跨境 url（实测从国内慢到数分钟、超 5min 轮询窗口 → 前端看不到图）。
  // 实测 relay-edits-probe：带此参 → 200 直接回 b64（~48s）、不带 → 回 url（需慢速下载）。
  fd.append("response_format", "b64_json");
  if (req.quality && req.quality !== "auto") fd.append("quality", req.quality);
  if (req.background && req.background !== "auto") fd.append("background", req.background);
  fd.append(
    "image",
    new Blob([new Uint8Array(req.inputImage.bytes)], { type: req.inputImage.contentType }),
    req.inputImage.filename,
  );
  return fd;
}

export async function callRelay(req: {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImage?: RelayInputImage | null; // ④b：有值 → 走 /images/edits multipart（图生图），无 → JSON 文生图
}): Promise<{ images: RelayImage[]; raw: unknown }> {
  const key = await relayKey(); // ★ 只在 Background Function 解析（app_config 优先、回退 env）
  const bases = await relayBases();
  const isEdit = !!req.inputImage;
  const endpoint = isEdit ? "/images/edits" : undefined; // undefined → 默认 /images/generations
  // JSON 文生图 body 不变（一次构造可复用）；图生图 multipart 每次新建（见 buildEditsForm）。
  const jsonBody = isEdit
    ? null
    : JSON.stringify({
        ...buildImageGenerationPayload({
          model: "gpt-image-2",
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

  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RELAY_SOFT_TIMEOUT_MS); // 软超时 → AbortError → provider_timeout
    try {
      const resp = await fetch(buildImageGenerationUrl(base, endpoint), {
        method: "POST",
        signal: ctrl.signal,
        // 图生图：仅 Authorization，Content-Type 由 FormData 自动设（含 boundary）；文生图：JSON。
        headers: isEdit
          ? { Authorization: `Bearer ${key}` }
          : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: isEdit
          ? buildEditsForm({
              prompt: req.prompt,
              size: req.size,
              quality: req.quality,
              background: req.background,
              // biome-ignore lint/style/noNonNullAssertion: isEdit 蕴含 inputImage 非空
              inputImage: req.inputImage!,
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
      const images = parseImageGenerationResponse(raw).map(toRelayImage);
      return { images, raw };
    } catch (err) {
      lastErr = err;
      const isAbort = (err as { name?: string })?.name === "AbortError";
      // AbortError（软超时）= 请求已发出、不知中转是否在跑 → 不退避重试（防重复下单），直接抛走 provider_timeout。
      if (isAbort || !isRetriable(err) || i === bases.length - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 + i * 500)); // 退避后退到备用 Base 重试一次
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
