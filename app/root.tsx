import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { LightboxProvider } from "../src/components/Lightbox/LightboxProvider";
import { ToastProvider } from "../src/components/Toast/ToastProvider";
import { parseThemeCookie, type Theme, ThemeProvider } from "../src/lib/theme";
import type { Route } from "./+types/root";
// 全局设计令牌（side-effect import；RR 收集进 <Links/> 注入，SSR 无 FOUC）
import "../src/styles/tokens.css";

export function loader({ request }: Route.LoaderArgs) {
  return { theme: parseThemeCookie(request.headers.get("Cookie")) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // 在 Layout 内读 root loader 数据（错误态可能为空，兜底 light）。
  const data = useRouteLoaderData<typeof loader>("root");
  const theme: Theme = data?.theme ?? "light";
  return (
    <html lang="zh-CN" data-theme={theme}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AI 图像工坊</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  // 每个浏览器会话一个 QueryClient（SSR 安全：用 useState 惰性建一次）。
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider initialTheme={loaderData.theme}>
        <ToastProvider>
          <LightboxProvider>
            <Outlet />
          </LightboxProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "出错了";
  let detail = "";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === "string" ? error.data : "";
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <main style={{ padding: "var(--space-8)", fontFamily: "var(--font-sans)" }}>
      <h1 style={{ color: "var(--text-primary)" }}>{title}</h1>
      {detail ? <p style={{ color: "var(--text-secondary)" }}>{detail}</p> : null}
    </main>
  );
}
