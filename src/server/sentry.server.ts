// ★server-only：可观测出口（⑦ · 真相源 10 §11.9）。Sentry 初始化 + 捕获。
//  - SENTRY_DSN 缺 → no-op（仅 console 兜底，绝不丢信号）；
//  - @sentry/node 为「可选依赖」（站长后补 DSN 才装），用变量 specifier 动态 import，
//    避免 tsc/vite 静态解析未安装的包（缺包/初始化失败 → 静默降级 no-op，绝不抛）。
//
// 🔴 红线：捕获永不抛（告警/可观测自身故障不能拖垮业务/cron）；DSN 缺 = no-op；密钥不进 bundle（本文件 server-only）。

type SentryLevel = "fatal" | "error" | "warning" | "info";

interface SentryLike {
  captureException(e: unknown, hint?: unknown): unknown;
  captureMessage(msg: string, ctx?: unknown): unknown;
}

// 懒初始化、缓存 Promise（serverless 内同进程复用；DSN 缺 → 直接 null）。
let initPromise: Promise<SentryLike | null> | null = null;

async function getSentry(): Promise<SentryLike | null> {
  if (!process.env.SENTRY_DSN) return null;
  if (!initPromise) {
    initPromise = (async (): Promise<SentryLike | null> => {
      try {
        // 变量 specifier：tsc(moduleResolution:Bundler)/vite 不会静态解析此包，未装也不报错。
        const moduleName = "@sentry/node";
        const Sentry = (await import(/* @vite-ignore */ moduleName)) as {
          init(opts: Record<string, unknown>): void;
        } & SentryLike;
        Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
        return Sentry;
      } catch (e) {
        console.error("[sentry] init 失败（@sentry/node 未安装或 DSN 无效），降级为 no-op", e);
        return null;
      }
    })();
  }
  return initPromise;
}

/** 捕获异常（永不抛）。无 DSN/未装包 → 仅 console.error 兜底。 */
export async function captureException(e: unknown, context?: Record<string, unknown>): Promise<void> {
  console.error("[sentry:exception]", e, context ? JSON.stringify(context) : "");
  const s = await getSentry();
  try {
    s?.captureException(e, context ? { extra: context } : undefined);
  } catch (err) {
    console.error("[sentry] captureException 自身失败", err);
  }
}

/** 捕获消息（业务阈值告警经 alert.server 调用）。永不抛。 */
export async function captureMessage(
  msg: string,
  level: SentryLevel = "warning",
  context?: Record<string, unknown>,
): Promise<void> {
  console.warn(`[sentry:${level}] ${msg}`, context ? JSON.stringify(context) : "");
  const s = await getSentry();
  try {
    s?.captureMessage(msg, { level, extra: context });
  } catch (err) {
    console.error("[sentry] captureMessage 自身失败", err);
  }
}
