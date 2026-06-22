// P3-S4 灵感库运营化：对真 Neon 验 loadInspirations(SQL 过滤/动态品类/宽高回流/LIKE 转义) + admin CRUD/reorder/上下架。
// 跑：node --env-file=.env --import tsx scripts/inspirations-smoke.ts
// 不碰钱/码；用唯一前缀的测试卡 + 临时 admin 用户，结束清理（审计行先删再删用户，FK RESTRICT）。
import { randomUUID } from "node:crypto";
import { getPool, getSql } from "../src/db/db.server";
import {
  createInspiration,
  deleteInspiration,
  listAllInspirations,
  reorderInspiration,
  updateInspiration,
} from "../src/server/admin/inspirations.server";
import { loadInspirations } from "../src/server/reads.server";

const sql = getSql();
const checks: [string, boolean][] = [];
const P = `S4-${Date.now().toString(36)}`; // 唯一前缀，隔离本轮测试卡
const created: string[] = [];

async function ensureDimsColumns(): Promise<void> {
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "width" integer`);
    await c.query(`ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "height" integer`);
  } finally {
    c.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  await ensureDimsColumns();

  // 临时 admin（createInspiration 的审计 admin_id → users.id FK）。
  const adminId = randomUUID();
  await sql`INSERT INTO users(id,email,has_paid,max_concurrency,role)
            VALUES (${adminId}, ${`${P}+admin@example.com`}, false, 2, 'admin')`;

  const catFire = `${P}烟花`;
  const catSky = `${P}星空`;
  const catHidden = `${P}隐藏`;

  // 建测试卡：A/C 同品类(catFire)、B(catSky)、D 下架(catHidden)、E 无品类。带宽高 + 可搜 token。
  const a = (await createInspiration({ adminId, fields: { title: `${P}城市烟花`, cover: "https://x/a.png", category: catFire, prompt: `${P}token-fire 夜空烟花`, summary: "绚烂", width: 800, height: 1200, sort: 0, active: true } })).id;
  const b = (await createInspiration({ adminId, fields: { title: `${P}银河星空`, cover: "https://x/b.png", category: catSky, prompt: `${P}token-sky 深空银河`, sort: 0, active: true } })).id;
  const cc = (await createInspiration({ adminId, fields: { title: `${P}节日烟花`, cover: "https://x/c.png", category: catFire, prompt: `${P}token-fire2 礼花`, sort: 0, active: true } })).id;
  const d = (await createInspiration({ adminId, fields: { title: `${P}隐藏卡`, cover: "https://x/d.png", category: catHidden, prompt: `${P}token-hidden`, sort: 0, active: false } })).id;
  const e = (await createInspiration({ adminId, fields: { title: `${P}无品类`, cover: "https://x/e.png", category: null, prompt: `${P}token-nocat`, sort: 0, active: true } })).id;
  // 转义验证卡：标题含字面文本（无 %），搜 "...%..." 不应命中（% 被转义为字面）。
  const pct = (await createInspiration({ adminId, fields: { title: `${P}PCTneedle`, cover: "https://x/p.png", category: catSky, prompt: `${P}token-pct`, sort: 0, active: true } })).id;
  created.push(a, b, cc, d, e, pct);

  // —— 1) loadInspirations() 无筛选：active 子集 + 动态品类（DISTINCT 去重、排除下架/空品类）——
  const all = await loadInspirations();
  const allIds = new Set(all.items.map((i) => i.id));
  checks.push(["全部: 含 active A/B/C/E/PCT", [a, b, cc, e, pct].every((id) => allIds.has(id))]);
  checks.push(["全部: 不含下架 D", !allIds.has(d)]);
  checks.push(["品类: 含 catFire/catSky", all.categories.includes(catFire) && all.categories.includes(catSky)]);
  checks.push(["品类: DISTINCT 去重（catFire 仅 1 次）", all.categories.filter((x) => x === catFire).length === 1]);
  checks.push(["品类: 排除下架卡品类 catHidden", !all.categories.includes(catHidden)]);
  checks.push(["品类: 不含「全部」", !all.categories.includes("全部")]);

  // —— 2) 宽高回流（瀑布流原比例）——
  const aItem = all.items.find((i) => i.id === a);
  checks.push(["宽高回流: A=800x1200", aItem?.width === 800 && aItem?.height === 1200]);
  const bItem = all.items.find((i) => i.id === b);
  checks.push(["宽高可空: B 未填 → null", bItem?.width === null && bItem?.height === null]);

  // —— 3) 红线: 只读 cover，不暴露 cover_key/storage_key ——
  checks.push([
    "红线: item 无 coverKey/storageKey 字段",
    !!aItem && !("coverKey" in aItem) && !("storageKey" in aItem) && typeof aItem.cover === "string",
  ]);

  // —— 4) 品类过滤下沉 SQL ——
  const fire = await loadInspirations(catFire);
  checks.push(["品类过滤: catFire → 恰 A、C", fire.items.length === 2 && fire.items.every((i) => i.category === catFire)]);
  const allCat = await loadInspirations("全部");
  checks.push(["「全部」不按品类过滤", new Set(allCat.items.map((i) => i.id)).has(e)]);

  // —— 5) 关键词搜索下沉 SQL（ILIKE 大小写不敏感）——
  const sky = await loadInspirations(undefined, "TOKEN-SKY"); // 大写，验 ILIKE
  checks.push(["搜索: TOKEN-SKY(大写) ILIKE 命中 B", sky.items.some((i) => i.id === b)]);
  const fireSearch = await loadInspirations(undefined, "token-fire");
  checks.push(["搜索: token-fire 命中 A、C", [a, cc].every((id) => fireSearch.items.some((i) => i.id === id))]);

  // —— 6) 品类 + 关键词叠加（AND）——
  const both = await loadInspirations(catFire, "token-fire2");
  checks.push(["叠加: catFire + token-fire2 → 仅 C", both.items.length === 1 && both.items[0].id === cc]);

  // —— 7) LIKE 元字符转义（% 当字面、不通配）——
  const pctHit = await loadInspirations(undefined, `${P}PCTneedle`);
  checks.push(["转义: 字面全名命中 PCT 卡", pctHit.items.some((i) => i.id === pct)]);
  const pctWild = await loadInspirations(undefined, `${P}PCT%needle`);
  checks.push(["转义: 含 % 不通配（PCT 卡不命中）", !pctWild.items.some((i) => i.id === pct)]);

  // —— 8) reorder：互换相邻 + 规整 sort，移回还原 ——
  const before = (await listAllInspirations()).items.map((i) => i.id);
  const ia = before.indexOf(a);
  const dir = ia < before.length - 1 ? "down" : "up";
  const ja = dir === "down" ? ia + 1 : ia - 1;
  const expected = [...before];
  [expected[ia], expected[ja]] = [expected[ja], expected[ia]];
  await reorderInspiration({ adminId, id: a, direction: dir });
  const after = (await listAllInspirations()).items.map((i) => i.id);
  checks.push([`reorder: ${dir} 后顺序按预期互换`, JSON.stringify(after) === JSON.stringify(expected)]);
  // sort 规整为 0..N-1 全互异
  const sorts = (await listAllInspirations()).items.map((i) => i.sort);
  checks.push(["reorder: sort 规整为 0..N-1 互异", new Set(sorts).size === sorts.length && sorts[0] === 0]);
  await reorderInspiration({ adminId, id: a, direction: dir === "down" ? "up" : "down" });
  const restored = (await listAllInspirations()).items.map((i) => i.id);
  checks.push(["reorder: 移回还原顺序", JSON.stringify(restored) === JSON.stringify(before)]);

  // —— 9) 上下架（update active）——
  await updateInspiration({ adminId, id: a, fields: { title: `${P}城市烟花`, cover: "https://x/a.png", category: catFire, prompt: `${P}token-fire 夜空烟花`, summary: "绚烂", width: 800, height: 1200, sort: 0, active: false } });
  const afterHide = await loadInspirations();
  checks.push(["上下架: A 下架后前台不可见", !afterHide.items.some((i) => i.id === a)]);

  // —— 10) 清理（删卡 → 删审计 → 删用户）——
  for (const id of created) {
    try {
      await deleteInspiration({ adminId, id });
    } catch {
      /* 已删/不存在 */
    }
  }
  await sql`DELETE FROM audit_log WHERE admin_id = ${adminId}`;
  await sql`DELETE FROM users WHERE id = ${adminId}`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[inspirations-smoke] ${pass ? "PASS" : "FAIL"} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[inspirations-smoke] FAIL:", e);
  process.exit(1);
});
