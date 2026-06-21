import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

// 主题（明/暗）：存 cookie → root loader 服务端读取并渲到 <html data-theme>（SSR 无闪烁）；
// 客户端切换改 cookie + DOM 即时生效，ThemeProvider 仅同步图标态。

export type Theme = "light" | "dark";
export const THEME_COOKIE = "theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseThemeCookie(cookieHeader: string | null | undefined): Theme {
  if (!cookieHeader) return "light";
  const match = cookieHeader.match(/(?:^|;\s*)theme=(light|dark)\b/);
  return (match?.[1] as Theme) ?? "light";
}

export function themeCookieHeader(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

export function applyThemeClient(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookieHeader(theme);
}

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      applyThemeClient(next);
      return next;
    });
  }, []);
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useThemeMode(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeMode must be used within <ThemeProvider>");
  return ctx;
}
