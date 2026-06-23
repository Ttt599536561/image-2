// ★server-only：灵感库 CRUD（09 §10.4）。非钱/码，单语句即可；但内容运营仍写 audit。
// 封面本期为 admin 贴公有 URL（cover_url）；multipart 上传 Supabase 留增强（cover_key 暂空）。
import { getSql } from "../../db/db.server";
import { storageKeyFromPublicUrl } from "../r2.server";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

/**
 * 从 cover_url 派生 cover_key（本桶 `inspirations/…` 封面 → 其 key；外链/贴 URL → null）。
 * 🔴 服务端派生、不靠客户端传：edit/快捷上下架重提交同一 cover_url 时自动得到同一 cover_key，
 *    绝不会把上传封面的 key 误清成 null（否则孤儿清理会把在用封面当孤儿删掉 = 丢图）。
 * cover_key 的用途：孤儿清理 cron known-set 保护在用封面；删/换后 cover_key 不再命中 → 自动回收。
 */
function deriveCoverKey(coverUrl: string): string | null {
  const k = storageKeyFromPublicUrl(coverUrl);
  return k && k.startsWith("inspirations/") ? k : null;
}

export interface AdminInspiration {
  id: string;
  title: string;
  cover: string; // cover_url
  category: string | null;
  prompt: string;
  summary: string | null;
  width: number | null; // 封面原始宽高（瀑布流原比例，P3-S4；可空）
  height: number | null;
  sort: number;
  active: boolean;
  createdAt: string;
}

/** 全部灵感卡（含未上架，按 sort, created_at）。 */
export async function listAllInspirations(): Promise<{ items: AdminInspiration[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, title, cover_url, category, prompt, summary, width, height, sort, active, created_at
    FROM inspirations ORDER BY sort ASC, created_at DESC`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      cover: r.cover_url as string,
      category: (r.category as string | null) ?? null,
      prompt: r.prompt as string,
      summary: (r.summary as string | null) ?? null,
      width: r.width === null || r.width === undefined ? null : Number(r.width),
      height: r.height === null || r.height === undefined ? null : Number(r.height),
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
  width?: number | null;
  height?: number | null;
  sort?: number;
  active?: boolean;
}

export async function createInspiration(args: { adminId: string; fields: InspirationFields; ip?: string | null }): Promise<{ id: string }> {
  const f = args.fields;
  return tx(async (c: TxClient) => {
    const r = await c.query(
      `INSERT INTO inspirations(title,cover_url,cover_key,category,prompt,summary,width,height,sort,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [f.title, f.cover, deriveCoverKey(f.cover), f.category ?? null, f.prompt, f.summary ?? null, f.width ?? null, f.height ?? null, f.sort ?? 0, f.active ?? true],
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
      `UPDATE inspirations SET title=$1,cover_url=$2,cover_key=$3,category=$4,prompt=$5,summary=$6,width=$7,height=$8,sort=$9,active=$10,updated_at=now() WHERE id=$11`,
      [f.title, f.cover, deriveCoverKey(f.cover), f.category ?? null, f.prompt, f.summary ?? null, f.width ?? null, f.height ?? null, f.sort ?? 0, f.active ?? true, args.id],
    );
    await writeAudit(c, { adminId: args.adminId, action: "edit_inspiration", targetType: "inspiration", targetId: args.id, before, after: f, ip: args.ip ?? null });
  });
}

/**
 * 上/下移一位（P3-S4「排序编辑体验」，免手填 sort 数字）。
 * 在事务内取全表当前顺序（sort ASC, created_at DESC）→ 与相邻项互换 → 规整 sort=新下标（0..N-1，去重/去间隙）。
 * 规整以「新下标 ≠ 当前 sort」为写入条件（而非「id 是否换位」）：否则 sort 有并列/间隙时，未写入的行会保留旧
 * sort 值、被 ORDER BY 重新打散，互换落空。规整后全表 sort 互不相同，created_at 兜底永不触发。
 * 边界（已在首/末）为幂等 no-op。卡数少（admin 维护），写入成本可忽略。
 */
export async function reorderInspiration(args: {
  adminId: string;
  id: string;
  direction: "up" | "down";
  ip?: string | null;
}): Promise<void> {
  await tx(async (c: TxClient) => {
    const rows = (await c.query("SELECT id, sort FROM inspirations ORDER BY sort ASC, created_at DESC")).rows as {
      id: string;
      sort: number;
    }[];
    const idx = rows.findIndex((r) => r.id === args.id);
    if (idx < 0) throw new Response("灵感卡不存在", { status: 404 });
    const swap = args.direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= rows.length) return; // 已在首/末 → no-op
    const order = rows.map((r) => r.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    const curSort = new Map(rows.map((r) => [r.id, Number(r.sort)]));
    // 规整全表 sort=新下标；只写「与当前 sort 不一致」的行（最少写入，结果仍是 0..N-1 全互异）。
    for (let i = 0; i < order.length; i++) {
      if (curSort.get(order[i]) !== i) {
        await c.query("UPDATE inspirations SET sort=$1, updated_at=now() WHERE id=$2", [i, order[i]]);
      }
    }
    await writeAudit(c, {
      adminId: args.adminId,
      action: "reorder_inspiration",
      targetType: "inspiration",
      targetId: args.id,
      after: { direction: args.direction, from: idx, to: swap },
      ip: args.ip ?? null,
    });
  });
}

/** 硬删 + 审计。上传封面（cover_key 在 inspirations/…）删除后 cover_key 不再命中孤儿 known-set →
 *  下次清理 cron 自动按孤儿(>1h)回收对象，无需在此显式删 R2（贴 URL 的封面是外链、本就无对象）。 */
export async function deleteInspiration(args: { adminId: string; id: string; ip?: string | null }): Promise<void> {
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM inspirations WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("灵感卡不存在", { status: 404 });
    await c.query("DELETE FROM inspirations WHERE id=$1", [args.id]);
    await writeAudit(c, { adminId: args.adminId, action: "delete_inspiration", targetType: "inspiration", targetId: args.id, before, ip: args.ip ?? null });
  });
}
