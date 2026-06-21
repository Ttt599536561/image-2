import { dimensionsFor } from "../components/composer/sizeOptions";
import type { Size } from "../contracts/generate";

// 阶段一无真出图：用按比例的渐变 SVG 占位图（data URL），不同提示词给不同色相，体验更真。

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 生成按所选比例的占位成品图（渐变 + 提示词截断 + 比例标签）。占位图维度恒非空，
 *  返回非空 dims 类型（可赋给可空的 GeneratedImage / succeeded 契约，亦满足非空的 InspirationItem）。 */
export function makePlaceholderImage(
  prompt: string,
  size: Size,
): { publicUrl: string; width: number; height: number } {
  const { width, height } = dimensionsFor(size);
  const hue = hashHue(prompt || "image");
  const hue2 = (hue + 48) % 360;
  const label = escapeXml((prompt || "AI 图像").slice(0, 18));
  const ratio = size === "auto" ? "智能" : size.replace("x", " × ");
  const fontMain = Math.round(Math.min(width, height) / 12);
  const fontSub = Math.round(Math.min(width, height) / 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 62%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 52% 46%)"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <circle cx="${width * 0.78}" cy="${height * 0.24}" r="${Math.min(width, height) * 0.16}" fill="hsl(${hue2} 60% 70%)" opacity="0.5"/>
  <text x="50%" y="48%" fill="rgba(255,255,255,0.96)" font-family="system-ui, sans-serif" font-size="${fontMain}" font-weight="600" text-anchor="middle">${label}</text>
  <text x="50%" y="58%" fill="rgba(255,255,255,0.78)" font-family="system-ui, sans-serif" font-size="${fontSub}" text-anchor="middle">${ratio}</text>
</svg>`;
  return {
    publicUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}
