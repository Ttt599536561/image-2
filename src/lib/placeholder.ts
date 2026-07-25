import { dimensionsFor } from "../components/composer/sizeOptions";
import type { Size } from "../contracts/generate";

// 占位封面图（data URL 渐变 SVG）。阶段二仅用于「灵感库」种子封面（inspirations 表归 §6 后台；
// 在那之前 /api/inspirations 返回服务端种子，封面用此占位）。真出图一律走 Supabase public_url。
//
// 视觉原则：与设计系统同源——暖纸底、低饱和陶土/橄榄/沙色系、细腻颗粒，
// 避免高饱和平涂色块与页面气质割裂（融入感优先于"抢眼"）。

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

/**
 * 把任意哈希色相收敛到网站的暖色系族谱：
 * 陶土(18°)、沙金(38°)、橄榄(75°)、灰蓝(205°)、暖褐(28°)，
 * 再压低饱和度，使任意标题生成的占位图都不刺眼。
 */
const PALETTE_HUES = [18, 38, 75, 205, 28] as const;

/** 生成按所选比例的占位封面（暖调渐变 + 颗粒 + 标题 + 比例标签）。维度恒非空。 */
export function makePlaceholderImage(
  prompt: string,
  size: Size,
): { publicUrl: string; width: number; height: number } {
  const { width, height } = dimensionsFor(size);
  const h1 = PALETTE_HUES[hashHue(prompt || "image") % PALETTE_HUES.length];
  const h2 = PALETTE_HUES[(hashHue(prompt || "image") + 1) % PALETTE_HUES.length];
  const label = escapeXml((prompt || "AI 图像").slice(0, 18));
  const ratio = size === "auto" ? "智能" : size.replace("x", " × ");
  const fontMain = Math.round(Math.min(width, height) / 13);
  const fontSub = Math.round(Math.min(width, height) / 26);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h1} 26% 80%)"/>
      <stop offset="0.55" stop-color="hsl(${h1} 22% 70%)"/>
      <stop offset="1" stop-color="hsl(${h2} 20% 56%)"/>
    </linearGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <circle cx="${width * 0.76}" cy="${height * 0.22}" r="${Math.min(width, height) * 0.2}" fill="hsl(${h2} 30% 86%)" opacity="0.45"/>
  <circle cx="${width * 0.16}" cy="${height * 0.86}" r="${Math.min(width, height) * 0.14}" fill="hsl(${h1} 24% 64%)" opacity="0.35"/>
  <rect width="${width}" height="${height}" filter="url(#grain)"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2" rx="6"/>
  <text x="50%" y="48%" fill="rgba(255,255,255,0.95)" font-family="system-ui, sans-serif" font-size="${fontMain}" font-weight="600" text-anchor="middle" style="text-shadow:0 1px 6px rgba(0,0,0,0.18)">${label}</text>
  <text x="50%" y="58%" fill="rgba(255,255,255,0.75)" font-family="system-ui, sans-serif" font-size="${fontSub}" text-anchor="middle">${ratio}</text>
</svg>`;
  return {
    publicUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width,
    height,
  };
}
