// 资产库筛选/框选的纯逻辑助手（P3-S1）。无 DOM/React 依赖，便于单测。

/** AABB 相交判定：缩略图 DOMRect vs 框选矩形（viewport 坐标）。命中即纳入框选。 */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * 「N 天后过期」角标天数（§24-5）：剩 ≤3 天才显示。
 * 返回 1..3 表示剩余整天数（向上取整）；已过期/无到期/>3 天返回 null（不显示）。
 * now 可注入（测试用），缺省取当前时间。
 */
export function expiringInDays(expiresAt: string | null, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const days = Math.ceil(ms / 86_400_000);
  return days <= 3 ? days : null;
}

/** 本地日期 YYYY-MM-DD（date input 值 / 边界）。 */
export function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
