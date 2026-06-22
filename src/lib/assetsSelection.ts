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

// ===================== 自定义日期区间控件（#4）纯逻辑 =====================
// YYYY-MM-DD 同格式字符串可直接字典序比较 = 时间序比较，故区间判定无需 Date。

/** 解析 YYYY-MM-DD → {y,m,d}（m 为 1-12）；非法返回 null。 */
export function parseDay(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** {y,m1,d} → YYYY-MM-DD（m1 为 1-12）。 */
export function fmtDay(y: number, m1: number, d: number): string {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 该月日历网格（按周日起，长度补足为 7 的倍数）。
 * 每格为 YYYY-MM-DD，月首前/月末后的补位为 null。year + month1(1-12)。
 */
export function monthGrid(year: number, month1: number): (string | null)[] {
  const startDow = new Date(year, month1 - 1, 1).getDay(); // 0=周日
  const daysInMonth = new Date(year, month1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(fmtDay(year, month1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 月份步进（month1 为 1-12，可正负），返回 {year, month1}。 */
export function stepMonth(year: number, month1: number, delta: number): { year: number; month1: number } {
  const idx = (year * 12 + (month1 - 1)) + delta;
  return { year: Math.floor(idx / 12), month1: (idx % 12) + 1 };
}

/** ymd 是否落在 [min,max] 闭区间内（任一边界空=不限）。同格式字典序比较。 */
export function dayInBounds(ymd: string, min?: string, max?: string): boolean {
  if (min && ymd < min) return false;
  if (max && ymd > max) return false;
  return true;
}

/** 区间态：start=区间起点，end=区间终点，in=严格之间，none=不在区间。 */
export function rangeState(ymd: string, from: string, to: string): "start" | "end" | "in" | "none" {
  if (from && ymd === from) return "start";
  if (to && ymd === to) return "end";
  if (from && to && ymd > from && ymd < to) return "in";
  return "none";
}
