// 展示层格式化（金额一律存整数 mp/分，展示才换算；docs/dev 全局约定）。

/** 毫积分 → 积分展示串。整数省小数（10000→"10"），否则最多 2 位（70→"0.07"、5860→"5.86"）。 */
export function formatCredits(mp: number): string {
  const v = mp / 1000;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, "");
}

/** 分 → 元展示串（990→"9.9"）。 */
export function formatCash(cash: number): string {
  const v = cash / 100;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, "");
}

/** 毫秒 → "M:SS"（生成中计时；8000→"0:08"、65000→"1:05"）。 */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 有效期天数：NULL=永久。 */
export function formatValidDays(days: number | null): string {
  return days == null ? "永久有效" : `${days} 天有效`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 日期分组标签：今天 / 昨天 / M月D日（资产库 sticky 分组，规格 §12）。 */
export function dateGroupLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 距过期天数（向上取整；过期返回 0）。 */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS));
}

/** "MM-DD"（过期提示用，规格 §24.5）。 */
export function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
