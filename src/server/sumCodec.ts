// ★server-only：SUM/聚合 string codec（09 §10.7 / 10 §11.4）。
// 🔴 红线：mp/cash 求和可能超 2^53 → SQL 侧 `::text` 取出，JS 用 BigInt 解析，绝不直接 JS number SUM（截断把钱算错）。
// 看板对前端的大额一律返回 string（contract 用 z.string()）；count/avg 等小量可用 number。

/** `::text` 聚合值 → BigInt（null/undefined → 0n）。 */
export function toBigInt(v: unknown): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  return BigInt(String(v));
}

/** `::text` 聚合值 → 规范化 string（跨 JSON 安全，前端展示再 /1000 或 /100）。 */
export function sumStr(v: unknown): string {
  return toBigInt(v).toString();
}

/** 计数/小整数 → number（count、avg 取整等，安全在 2^53 内）。 */
export function toInt(v: unknown): number {
  return Number(v ?? 0);
}
