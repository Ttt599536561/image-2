// ★server-only：首页画廊 CRUD（F-073：管理后台手动配置未登录 /welcome 展示图）。
// 非钱/码，单语句即可；但内容运营仍写 audit（对齐灵感库纪律）。
import { getSql } from "../../db/db.server";
import { storageKeyFromPublicUrl } from "../r2.server";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

/**
 * 从 image_url 派生 image_key（本桶 `landing/…` 上传图 → 其 key；外链/贴 URL → null）。
 * 🔴 服务端派生、不靠客户端传：edit/快捷上下架重提交同一 image_url 时自动得到同一 image_key，
 *    绝不会把上传图的 key 误清成 null（否则孤儿清理会把在用图当孤儿删掉 = 门面丢图）。
 * image_key 的用途：孤儿清理 cron known-set 保护在用图；删/换后 image_key 不再命中 → 自动回收。
 */
function deriveImageKey(imageUrl: string): string | null {
  const k = storageKeyFromPublicUrl(imageUrl);
  return k && k.startsWith("landing/") ? k : null;
}

export interface AdminLandingItem {
  id: string;
  title: string;
  image: string; // image_url
  category: string | null;
  prompt: string; // 可空字符串（DB NOT NULL DEFAULT ''）
  summary: string | null;
  width: number | null; // 原始宽高（瀑布流原比例；可空）
  height: number | null;
  sort: number;
  active: boolean;
  createdAt: string;
}

/** 全部首页画廊卡（含未上架，按 sort, created_at）。 */
export async function listAllLandingItems(): Promise<{ items: AdminLandingItem[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, title, image_url, category, prompt, summary, width, height, sort, active, created_at
    FROM landing_gallery_items ORDER BY sort ASC, created_at DESC`) as Row[];
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      image: r.image_url as string,
      category: (r.category as string | null) ?? null,
      prompt: (r.prompt as string | null) ?? "",
      summary: (r.summary as string | null) ?? null,
      width: r.width === null || r.width === undefined ? null : Number(r.width),
      height: r.height === null || r.height === undefined ? null : Number(r.height),
      sort: Number(r.sort ?? 0),
      active: r.active === true,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
  };
}

export interface LandingItemFields {
  title: string;
  image: string;
  category?: string | null;
  prompt?: string;
  summary?: string | null;
  width?: number | null;
  height?: number | null;
  sort?: number;
  active?: boolean;
}

export async function createLandingItem(args: { adminId: string; fields: LandingItemFields; ip?: string | null }): Promise<{ id: string }> {
  const f = args.fields;
  return tx(async (c: TxClient) => {
    const r = await c.query(
      `INSERT INTO landing_gallery_items(title,image_url,image_key,category,prompt,summary,width,height,sort,active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [f.title, f.image, deriveImageKey(f.image), f.category ?? null, f.prompt ?? "", f.summary ?? null, f.width ?? null, f.height ?? null, f.sort ?? 0, f.active ?? true],
    );
    const id = r.rows[0].id as string;
    await writeAudit(c, { adminId: args.adminId, action: "create_landing_gallery", targetType: "landing_gallery", targetId: id, after: f, ip: args.ip ?? null });
    return { id };
  });
}

export async function updateLandingItem(args: { adminId: string; id: string; fields: LandingItemFields; ip?: string | null }): Promise<void> {
  const f = args.fields;
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM landing_gallery_items WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("画廊图不存在", { status: 404 });
    await c.query(
      `UPDATE landing_gallery_items SET title=$1,image_url=$2,image_key=$3,category=$4,prompt=$5,summary=$6,width=$7,height=$8,sort=$9,active=$10,updated_at=now() WHERE id=$11`,
      [f.title, f.image, deriveImageKey(f.image), f.category ?? null, f.prompt ?? "", f.summary ?? null, f.width ?? null, f.height ?? null, f.sort ?? 0, f.active ?? true, args.id],
    );
    await writeAudit(c, { adminId: args.adminId, action: "edit_landing_gallery", targetType: "landing_gallery", targetId: args.id, before, after: f, ip: args.ip ?? null });
  });
}

/**
 * 上/下移一位（与灵感库同一「排序编辑体验」）：事务内取全表当前顺序 → 与相邻项互换 →
 * 规整 sort=新下标（0..N-1，去重/去间隙）。边界（已在首/末）为幂等 no-op。
 */
export async function reorderLandingItem(args: {
  adminId: string;
  id: string;
  direction: "up" | "down";
  ip?: string | null;
}): Promise<void> {
  await tx(async (c: TxClient) => {
    const rows = (await c.query("SELECT id, sort FROM landing_gallery_items ORDER BY sort ASC, created_at DESC")).rows as {
      id: string;
      sort: number;
    }[];
    const idx = rows.findIndex((r) => r.id === args.id);
    if (idx < 0) throw new Response("画廊图不存在", { status: 404 });
    const swap = args.direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= rows.length) return; // 已在首/末 → no-op
    const order = rows.map((r) => r.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    const curSort = new Map(rows.map((r) => [r.id, Number(r.sort)]));
    for (let i = 0; i < order.length; i++) {
      if (curSort.get(order[i]) !== i) {
        await c.query("UPDATE landing_gallery_items SET sort=$1, updated_at=now() WHERE id=$2", [i, order[i]]);
      }
    }
    await writeAudit(c, {
      adminId: args.adminId,
      action: "reorder_landing_gallery",
      targetType: "landing_gallery",
      targetId: args.id,
      after: { direction: args.direction, from: idx, to: swap },
      ip: args.ip ?? null,
    });
  });
}

/** 硬删 + 审计。上传图（image_key 在 landing/…）删除后不再命中孤儿 known-set →
 *  下次清理 cron 自动按孤儿(>1h)回收对象，无需在此显式删（贴 URL 的图是外链、本就无对象）。 */
export async function deleteLandingItem(args: { adminId: string; id: string; ip?: string | null }): Promise<void> {
  await tx(async (c: TxClient) => {
    const before = (await c.query("SELECT * FROM landing_gallery_items WHERE id=$1", [args.id])).rows[0];
    if (!before) throw new Response("画廊图不存在", { status: 404 });
    await c.query("DELETE FROM landing_gallery_items WHERE id=$1", [args.id]);
    await writeAudit(c, { adminId: args.adminId, action: "delete_landing_gallery", targetType: "landing_gallery", targetId: args.id, before, ip: args.ip ?? null });
  });
}
