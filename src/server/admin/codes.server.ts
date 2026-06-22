// ★server-only：兑换码管理（09 §10.2）。批量生成(CSPRNG+套餐快照)/导出CSV/查单/作废批次/对账。
// 核销逻辑本身在 ③ redeem.server（本模块只发码/作废/对账）。🔴 码用 crypto.randomInt（禁 Math.random）+ 落套餐快照。
import { randomInt, randomUUID } from "node:crypto";
import { REDEEM_ALPHABET } from "../../contracts/redeem";
import { getSql } from "../../db/db.server";
import { sumStr, toInt } from "../sumCodec";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

function genCode(): string {
  let s = "";
  for (let i = 0; i < 18; i++) s += REDEEM_ALPHABET[randomInt(REDEEM_ALPHABET.length)];
  return s;
}

/** 批量生成（套餐快照 + 一批一个 batch_id；撞 code UNIQUE 则补生成缺口直至齐）+ 同事务审计。
 *  返回生成的码明文（供后台直接复制；站长诉求：不必下 CSV、可一键复制）。 */
export async function generateCodes(args: {
  adminId: string;
  packageId: string;
  count: number;
  ip?: string | null;
}): Promise<{ batchId: string; count: number; codes: string[] }> {
  return tx(async (c: TxClient) => {
    const pkg = (
      await c.query("SELECT title, price_cash, credits_mp, valid_days FROM packages WHERE id=$1", [args.packageId])
    ).rows[0] as { price_cash: number; credits_mp: number; valid_days: number | null } | undefined;
    if (!pkg) throw new Response("套餐不存在", { status: 404 });

    const batchId = randomUUID();
    const COLS = 7;
    const minted: string[] = [];
    let guard = 0;
    while (minted.length < args.count && guard < 50) {
      guard++;
      const need = args.count - minted.length;
      const codes = Array.from({ length: need }, genCode);
      const valuesSql = codes
        .map((_, i) => `($${i * COLS + 1},$${i * COLS + 2},$${i * COLS + 3},$${i * COLS + 4},$${i * COLS + 5},$${i * COLS + 6},$${i * COLS + 7})`)
        .join(",");
      const params = codes.flatMap((code) => [
        code,
        args.packageId,
        batchId,
        pkg.credits_mp, // 快照
        pkg.price_cash, // 面值现金（分）
        pkg.valid_days, // 快照；NULL=永久
        "active",
      ]);
      const r = await c.query(
        `INSERT INTO redeem_codes(code,package_id,batch_id,credits_value_mp,cash_value,valid_days,status)
         VALUES ${valuesSql} ON CONFLICT (code) DO NOTHING RETURNING code`,
        params,
      );
      for (const row of r.rows) minted.push(row.code as string);
    }
    if (minted.length < args.count) throw new Error("生成兑换码反复撞重，请重试");

    await writeAudit(c, {
      adminId: args.adminId,
      action: "gen_codes",
      targetType: "package",
      targetId: args.packageId,
      after: { batchId, count: args.count },
      ip: args.ip ?? null,
    });
    return { batchId, count: args.count, codes: minted };
  });
}

/** 作废批次（只动 active 码；已兑换不动账目）+ 同事务审计。返回受影响数。 */
export async function disableBatch(args: {
  adminId: string;
  batchId: string;
  ip?: string | null;
}): Promise<{ disabled: number }> {
  return tx(async (c: TxClient) => {
    const r = await c.query(
      "UPDATE redeem_codes SET status='disabled' WHERE batch_id=$1 AND status='active' RETURNING id",
      [args.batchId],
    );
    const disabled = r.rowCount ?? 0;
    await writeAudit(c, {
      adminId: args.adminId,
      action: "disable_batch",
      targetType: "code",
      targetId: args.batchId,
      after: { disabledCount: disabled },
      ip: args.ip ?? null,
    });
    return { disabled };
  });
}

/** 查单（HTTP 只读，09 §10.2）。 */
export async function getCodeStatus(code: string): Promise<{
  code: string;
  status: string;
  creditsValueMp: number;
  cashValue: number;
  validDays: number | null;
  batchId: string | null;
  redeemedByEmail: string | null;
  redeemedAt: string | null;
} | null> {
  const sql = getSql();
  const [r] = (await sql`
    SELECT rc.code, rc.status, rc.credits_value_mp, rc.cash_value, rc.valid_days, rc.batch_id,
           rc.redeemed_at, u.email AS redeemed_email
    FROM redeem_codes rc LEFT JOIN users u ON u.id = rc.redeemed_by
    WHERE rc.code = ${code} LIMIT 1`) as Row[];
  if (!r) return null;
  return {
    code: r.code as string,
    status: r.status as string,
    creditsValueMp: toInt(r.credits_value_mp),
    cashValue: toInt(r.cash_value),
    validDays: r.valid_days == null ? null : toInt(r.valid_days),
    batchId: (r.batch_id as string | null) ?? null,
    redeemedByEmail: (r.redeemed_email as string | null) ?? null,
    redeemedAt: r.redeemed_at == null ? null : new Date(r.redeemed_at as string).toISOString(),
  };
}

/** 批次对账（HTTP 只读聚合；金额 SUM 走 string codec，09 §10.2/§10.7）。 */
export async function batchReconcile(batchId: string): Promise<{
  issued: number;
  used: number;
  unused: number;
  disabled: number;
  revenueCash: string;
  issuedCash: string;
}> {
  const sql = getSql();
  const [r] = (await sql`
    SELECT count(*) AS issued,
           count(*) FILTER (WHERE status='redeemed') AS used,
           count(*) FILTER (WHERE status='active')   AS unused,
           count(*) FILTER (WHERE status='disabled') AS disabled,
           COALESCE(sum(cash_value) FILTER (WHERE status='redeemed'),0)::text AS revenue_cash,
           COALESCE(sum(cash_value),0)::text AS issued_cash
    FROM redeem_codes WHERE batch_id = ${batchId}`) as Row[];
  return {
    issued: toInt(r.issued),
    used: toInt(r.used),
    unused: toInt(r.unused),
    disabled: toInt(r.disabled),
    revenueCash: sumStr(r.revenue_cash),
    issuedCash: sumStr(r.issued_cash),
  };
}

/** 批次列表（最近批次概览，供后台列表页；按最近生成倒序）。 */
export async function listBatches(page = 1, pageSize = 50): Promise<{
  items: { batchId: string; packageTitle: string | null; total: number; createdAt: string }[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const sql = getSql();
  const offset = (page - 1) * pageSize;
  const rows = (await sql`
    SELECT rc.batch_id, MIN(rc.created_at) AS created_at, COUNT(*)::int AS total,
           MAX(p.title) AS package_title
    FROM redeem_codes rc LEFT JOIN packages p ON p.id = rc.package_id
    WHERE rc.batch_id IS NOT NULL
    GROUP BY rc.batch_id
    ORDER BY MIN(rc.created_at) DESC
    LIMIT ${pageSize} OFFSET ${offset}`) as Row[];
  const [c] = (await sql`SELECT COUNT(DISTINCT batch_id)::int AS n FROM redeem_codes WHERE batch_id IS NOT NULL`) as Row[];
  return {
    items: rows.map((r) => ({
      batchId: r.batch_id as string,
      packageTitle: (r.package_title as string | null) ?? null,
      total: toInt(r.total),
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    total: toInt(c?.n),
    page,
    pageSize,
  };
}

/** 导出批次 CSV（BOM 防 Excel 乱码；金额展示层换算）。返回 {csv, filename}。 */
export async function exportBatchCsv(batchId: string): Promise<{ csv: string; filename: string }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT code, cash_value, credits_value_mp, valid_days FROM redeem_codes
    WHERE batch_id = ${batchId} ORDER BY created_at`) as Row[];
  const header = "code,price_yuan,credits,valid_days\n";
  const body = rows
    .map(
      (r) =>
        `${r.code},${(toInt(r.cash_value) / 100).toFixed(2)},${toInt(r.credits_value_mp) / 1000},${r.valid_days == null ? "永久" : toInt(r.valid_days)}`,
    )
    .join("\n");
  const csv = `﻿${header}${body}\n`; // BOM 前缀
  return { csv, filename: `codes_${batchId.slice(0, 8)}.csv` };
}
