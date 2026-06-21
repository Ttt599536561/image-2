import type { Background, Quality, Size } from "../../contracts/generate";

// 复用 v1 GeneratorForm 的 6 档「按用途」尺寸场景（唯一尺寸入口，docs/dev 08 §9.6 / 规格 §5.1）。
export type SizeOption = {
  value: Size;
  title: string;
  scene: string;
  isAuto?: boolean;
  recommended?: boolean;
  previewWidth?: number;
  previewHeight?: number;
};

export const SIZE_OPTIONS: SizeOption[] = [
  { value: "auto", title: "智能", scene: "AI 自动选择比例", isAuto: true, recommended: true },
  { value: "1024x1024", title: "1:1 方形", scene: "头像 · 商品 · 社交方图", previewWidth: 24, previewHeight: 24 },
  { value: "1024x1536", title: "2:3 竖图", scene: "海报 · 人像 · 杂志封面", previewWidth: 16, previewHeight: 24 },
  { value: "1536x1024", title: "3:2 横图", scene: "风景 · 横版插画", previewWidth: 24, previewHeight: 16 },
  { value: "1088x1920", title: "9:16 竖屏", scene: "手机壁纸 · 短视频", previewWidth: 14, previewHeight: 24 },
  { value: "1920x1088", title: "16:9 横屏", scene: "电脑壁纸 · 视频封面", previewWidth: 24, previewHeight: 14 },
];

export const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

export const BACKGROUND_OPTIONS: { value: Background; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "transparent", label: "透明" },
  { value: "opaque", label: "不透明" },
];

/** 像素尺寸（auto 兜底 1024×1024）。 */
export function dimensionsFor(size: Size): { width: number; height: number } {
  if (size === "auto") return { width: 1024, height: 1024 };
  const [w, h] = size.split("x").map(Number);
  return { width: w, height: h };
}

/** 宽高比 width/height（用于星空骨架/缩略图按比例铺满；auto→1）。 */
export function aspectRatioFor(size: Size): number {
  const { width, height } = dimensionsFor(size);
  return width / height;
}

export function sizeLabel(size: Size): string {
  return SIZE_OPTIONS.find((o) => o.value === size)?.title ?? size;
}
