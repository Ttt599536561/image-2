// 主题（明/暗）—— 存 cookie，root loader 服务端读取并渲到 <html data-theme>，
// 从而 SSR 首屏就带正确主题、无闪烁。客户端切换改 cookie + DOM 即时生效。

export type Theme = "light" | "dark";

export const THEME_COOKIE = "theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** 从请求的 Cookie 头解析主题（缺省 light）。 */
export function parseThemeCookie(cookieHeader: string | null | undefined): Theme {
  if (!cookieHeader) return "light";
  const match = cookieHeader.match(/(?:^|;\s*)theme=(light|dark)\b/);
  return (match?.[1] as Theme) ?? "light";
}

/** 生成 Set-Cookie 头值（阶段二写操作可复用）。 */
export function themeCookieHeader(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

/** 客户端即时切换：写 cookie + 翻 <html data-theme>。 */
export function applyThemeClient(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookieHeader(theme);
}
