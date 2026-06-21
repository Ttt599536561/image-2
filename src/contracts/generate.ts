// 生成契约（形状对齐 docs/dev 07-api §8.5 的 GenerateRequest / GenerateStatusResponse 判别联合）。
// 阶段一不引 zod（phase-2 才上 zod/drizzle-zod），这里用纯 TS 类型 + const 数组，
// 让 mock 与 UI 共享同一形状；阶段二只把「mock fetch」换成真 REST，类型不变。

export const SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1088x1920",
  "1920x1088",
] as const;
export type Size = (typeof SIZES)[number];

export const QUALITIES = ["auto", "high", "medium", "low"] as const;
export type Quality = (typeof QUALITIES)[number];

export const BACKGROUNDS = ["auto", "transparent", "opaque"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export interface GenerateRequest {
  prompt: string;
  size: Size;
  quality?: Quality;
  background?: Background;
  conversationId?: string;
  // 服务端固定：model=gpt-image-2 / n=1 / moderation=low，前端不收不发。
}

// 归一化失败枚举（六值，对齐 04 §5.8 / 09 §10.5）。
export const ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "provider_timeout",
  "content_rejected",
  "relay_unreachable",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface GeneratedImage {
  publicUrl: string;
  width: number;
  height: number;
}

// 按 status 的判别联合（与 07 §8.5 逐字段一致）。
export type GenerateStatusResponse =
  | { status: "queued" | "claimed" | "running"; startedAt?: string; elapsedMs?: number }
  | {
      status: "succeeded";
      image: GeneratedImage;
      creditsChargedMp: number;
      durationMs: number;
    }
  | {
      status: "failed";
      errorCode: ErrorCode;
      error: string;
      httpStatus: number | null;
    };

// POST /api/generate 入队成功（202）。
export interface GenerateAccepted {
  generationId: string;
  status: "queued";
}
