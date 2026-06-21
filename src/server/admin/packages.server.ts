// ★server-only：套餐管理（09 §10.6）。列表(含未上架)/新增/编辑/软删。
// 🔴 红线：删套餐用软删 active=false（禁硬删；redeem_codes.package_id FK ON DELETE RESTRICT，禁 CASCADE）；
//   改套餐不回溯已发码（码入库即快照）。低频写用 tx + 同事务审计。
import { getSql } from "../../db/db.server";
import { toInt } from "../sumCodec";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

export interface AdminPackage {
  id: string;
  title: string;
  description: string | null;
  priceCash: number;
  creditsMp: number;
  validDays: number | null;
  redirectUrl: string | null;
  sort: number;
  active: boolean;
  codeCount: number; // 该套餐已发码数（删/改影响提示）
}

/** 全部套餐（含未上架，含已发码数；按 sort）。 */
export async function listAllPackages(): Promise<{ items: AdminPackage[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT p.id, p.title, p.description, p.price_cash, p.credits_mp, p.valid_days, p.redirect_url,
           p.sort, p.active, COUNT(rc.id)::int AS code_count
    FROM packages p LEFT JOIN redeem_codes rc ON rc.package_id = p.id
    GROUP BY p.id
    ORDER BY p.sort ASC, p.created_at ASC`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      priceCash: toInt(r.price_cash),
      creditsMp: toInt(r.credits_mp),
      validDays: r.valid_days == null ? null : toInt(r.valid_days),
      redirectUrl: (r.redirect_url as string | null) ?? null,
      sort: toInt(r.sort),
      active: r.active === true,
      codeCount: toInt(r.code_count),
    })),
  };
}

export interface PackageFields {
  title: string;
  description?: string | null;
  priceCash: number;
  creditsMp: number;
  validDays: number | null;
  redirectUrl?: string | null;
  sort?: number;
  active?: boolean;
}

export async function createPackage(args: { adminId: string; fields: PackageFields; ip?: string | null }): Promise<{ id: string }> {
  const f = args.fields;
  return tx(async (c: TxClient) => {
    const r = await c.query(
      `INSERT INTO packages(title,description,price_cash,credits_mp,valid_days,redirect_url,sort,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [f.title, f.description ?? null, f.priceCash, f.creditsMp, f.validDays, f.redirectUrl ?? null, f.sort ?? 0, f.active ?? true],
    );
    const id = r.rows[0].id as string;
    await writeAudit(c, { adminId: args.adminId, action: "create_package", targetType: "package", targetId: id, after: f, ip: args.ip ?? null });
    return { id };
  });
}

export async function updatePackage(args: { adminId: string; id: string; fields: PackageFields; ip?: string | null }): Promise<void> {
  const f = args.fields;
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM packages WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("套餐不存在", { status: 404 });
    await c.query(
      `UPDATE packages SET title=$1,description=$2,price_cash=$3,credits_mp=$4,valid_days=$5,redirect_url=$6,sort=$7,active=$8,updated_at=now()
       WHERE id=$9`,
      [f.title, f.description ?? null, f.priceCash, f.creditsMp, f.validDays, f.redirectUrl ?? null, f.sort ?? 0, f.active ?? true, args.id],
    );
    await writeAudit(c, { adminId: args.adminId, action: "edit_package", targetType: "package", targetId: args.id, before, after: f, ip: args.ip ?? null });
  });
}

/** 软删（active=false，禁硬删）+ 审计。 */
export async function softDeletePackage(args: { adminId: string; id: string; ip?: string | null }): Promise<void> {
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT active FROM packages WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("套餐不存在", { status: 404 });
    await c.query("UPDATE packages SET active=false, updated_at=now() WHERE id=$1", [args.id]);
    await writeAudit(c, { adminId: args.adminId, action: "delete_package", targetType: "package", targetId: args.id, before, after: { active: false }, ip: args.ip ?? null });
  });
}
