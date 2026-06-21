// ★server-only：灵感库 CRUD（09 §10.4）。非钱/码，单语句即可；但内容运营仍写 audit。
// 封面本期为 admin 贴公有 URL（cover_url）；multipart 上传 Supabase 留增强（cover_key 暂空）。
import { getSql } from "../../db/db.server";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

export interface AdminInspiration {
  id: string;
  title: string;
  cover: string; // cover_url
  category: string | null;
  prompt: string;
  summary: string | null;
  sort: number;
  active: boolean;
  createdAt: string;
}

/** 全部灵感卡（含未上架，按 sort, created_at）。 */
export async function listAllInspirations(): Promise<{ items: AdminInspiration[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, title, cover_url, category, prompt, summary, sort, active, created_at
    FROM inspirations ORDER BY sort ASC, created_at DESC`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      cover: r.cover_url as string,
      category: (r.category as string | null) ?? null,
      prompt: r.prompt as string,
      summary: (r.summary as string | null) ?? null,
      sort: Number(r.sort ?? 0),
      active: r.active === true,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
  };
}

export interface InspirationFields {
  title: string;
  cover: string;
  category?: string | null;
  prompt: string;
  summary?: string | null;
  sort?: number;
  active?: boolean;
}

export async function createInspiration(args: { adminId: string; fields: InspirationFields; ip?: string | null }): Promise<{ id: string }> {
  const f = args.fields;
  return tx(async (c: TxClient) => {
    const r = await c.query(
      `INSERT INTO inspirations(title,cover_url,category,prompt,summary,sort,active)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [f.title, f.cover, f.category ?? null, f.prompt, f.summary ?? null, f.sort ?? 0, f.active ?? true],
    );
    const id = r.rows[0].id as string;
    await writeAudit(c, { adminId: args.adminId, action: "create_inspiration", targetType: "inspiration", targetId: id, after: f, ip: args.ip ?? null });
    return { id };
  });
}

export async function updateInspiration(args: { adminId: string; id: string; fields: InspirationFields; ip?: string | null }): Promise<void> {
  const f = args.fields;
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM inspirations WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("灵感卡不存在", { status: 404 });
    await c.query(
      `UPDATE inspirations SET title=$1,cover_url=$2,category=$3,prompt=$4,summary=$5,sort=$6,active=$7,updated_at=now() WHERE id=$8`,
      [f.title, f.cover, f.category ?? null, f.prompt, f.summary ?? null, f.sort ?? 0, f.active ?? true, args.id],
    );
    await writeAudit(c, { adminId: args.adminId, action: "edit_inspiration", targetType: "inspiration", targetId: args.id, before, after: f, ip: args.ip ?? null });
  });
}

/** 硬删（封面为贴入 URL、无 R2 对象需清；内容可重新添加）+ 审计。 */
export async function deleteInspiration(args: { adminId: string; id: string; ip?: string | null }): Promise<void> {
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM inspirations WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("灵感卡不存在", { status: 404 });
    await c.query("DELETE FROM inspirations WHERE id=$1", [args.id]);
    await writeAudit(c, { adminId: args.adminId, action: "delete_inspiration", targetType: "inspiration", targetId: args.id, before, ip: args.ip ?? null });
  });
}
