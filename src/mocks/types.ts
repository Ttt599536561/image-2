import type {
  Background,
  ErrorCode,
  GeneratedImage,
  Quality,
  Size,
} from "../contracts/generate";

export type TurnStatus = "running" | "succeeded" | "failed";

/** 一轮生成（对话流里的一条结果；阶段二映射 generations 行 + images 行）。 */
export interface Turn {
  id: string; // generationId
  prompt: string;
  size: Size;
  quality?: Quality;
  background?: Background;
  status: TurnStatus;
  image?: GeneratedImage;
  errorCode?: ErrorCode;
  error?: string;
  httpStatus?: number | null;
  createdAt: string;
  savedToLibrary?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  turns: Turn[];
}

export interface InspirationItem {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  category: string;
  cover: string; // publicUrl（瀑布流按原始比例不裁切）
  width: number;
  height: number;
}

export interface PackageItem {
  id: string;
  title: string;
  description: string;
  priceCash: number; // 分
  creditsMp: number; // 毫积分
  validDays: number | null; // NULL=永久
  redirectUrl: string;
  recommended?: boolean;
}

export interface MockUser {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
}

/** 3 天内即将过期（对齐 07 §8.3 expiringSoon；mp 走 string codec）。 */
export interface ExpiringSoon {
  mp: string;
  nearestExpiresAt: string | null;
}
