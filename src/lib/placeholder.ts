import { dimensionsFor } from "../components/composer/sizeOptions";
import type { Size } from "../contracts/generate";

// 占位封面图（data URL 渐变 SVG）。阶段二仅用于「灵感库」种子封面（inspirations 表归 §6 后台；
// 在那之前 /api/inspirations 返回服务端种子，封面用此占位）。真出图一律走 Supabase public_url。

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

/** 生成按所选比例的占位封面（渐变 + 标题截断 + 比例标签）。维度恒非空。 */
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
