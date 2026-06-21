// ★server-only：业务阈值告警统一出口（⑦ · 真相源 10 §11.9）。两条出口：
//  ① Sentry captureMessage（异常/性能追踪聚合）；② POST ADMIN_ALERT_WEBHOOK（推站长 IM/webhook）。
// ADMIN_ALERT_WEBHOOK 缺 → 仅走 Sentry/console；webhook POST 失败 → captureException（告警自身失败也不丢）。
//
// 🔴 红线：告警永不抛（cron/钱链路调用方靠它，不能被告警故障拖垮）；new Date 仅取时间戳（运行时 Node，非 Workflow 受限环境）。
import { captureException, captureMessage } from "./sentry.server";

// 告警项与阈值见 10 §11.9 表。
export type AlertKind =
  | "cron_failed" // 任一 cron handler 抛异常
  | "daily_budget_exhausted" // 当日中转预算达上限/近阈
  | "balance_reconcile_mismatch" // 物化余额 vs 批次和不平
  | "queue_timeout_rescan" // 单次超时重扫置 failed 的数量 >0
  | "queue_backlog" // queued 积压
  | "relay_success_rate_low" // 中转近 1h 成功率低
  | "relay_latency_high" // 中转 p95 时长高
  | "redeem_anomaly" // 兑换失败率/429 暴涨
  | "image_cleanup_failures"; // 清理 cron R2 删除失败的 key 数 >0

/** 统一告警：Sentry + 可选 webhook。永不抛。 */
export async function alert(kind: AlertKind, detail: unknown): Promise<void> {
  await captureMessage(`[alert] ${kind}`, "warning", { kind, detail });
  const url = process.env.ADMIN_ALERT_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, detail, at: new Date().toISOString() }),
    });
  } catch (e) {
    await captureException(e, { context: "alert webhook POST 失败", kind });
  }
}
