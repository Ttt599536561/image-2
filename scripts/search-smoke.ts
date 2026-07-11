// P3-S2 搜索：对真 Neon 验 loadConversations(q)/loadImages(q)（owner-scoped + LIKE 转义 + 命中/未命中）。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/search-smoke.ts
import { randomUUID } from "node:crypto";
import { getSql } from "../src/db/db.server";
import { loadConversations, loadImages } from "../src/server/reads.server";

const sql = getSql();
const checks: [string, boolean][] = [];
const userIds: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO users(id,email,has_paid,max_concurrency) VALUES (${id}, ${`srch+${id.slice(0, 12)}@example.com`}, false, 2)`;
  await sql`INSERT INTO credit_accounts(user_id,balance_mp) VALUES (${id}, 0)`;
  userIds.push(id);
  return id;
}

/** 建 conv(title) + gen(succeeded, prompt) + image。 */
async function mkConvImage(userId: string, title: string, prompt: string): Promise<void> {
  const convId = randomUUID();
  const genId = randomUUID();
  await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${userId}, ${title})`;
  await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at,completed_at)
            VALUES (${genId}, ${convId}, ${userId}, ${prompt}, 'auto', 'succeeded', now(), now())`;
  await sql`INSERT INTO images(id,generation_id,user_id,storage_key,public_url)
            VALUES (${randomUUID()}, ${genId}, ${userId}, ${`${userId}/x.png`}, ${`https://x/${userId}.png`})`;
}

async function main(): Promise<void> {
  const u1 = await mkUser();
  const u2 = await mkUser();
  await mkConvImage(u1, "海报设计 alpha", "a red dragon zeta on a hill");
  await mkConvImage(u1, "logo 草图 beta", "minimalist cat logo");
  await mkConvImage(u2, "海报设计 gamma", "a red dragon other-user"); // 同关键词、别的用户

  // —— 会话标题搜索 ——
  const c1 = await loadConversations(u1, 1, 20, "海报");
  checks.push(["会话: 搜「海报」命中 1（仅本人）", c1.total === 1 && c1.items.length === 1 && c1.items[0].title.includes("海报")]);
  const c2 = await loadConversations(u1, 1, 20, "logo");
  checks.push(["会话: 搜「logo」命中 1", c2.total === 1 && c2.items[0].title.includes("logo")]);
  const c3 = await loadConversations(u1, 1, 20, "不存在zzz");
  checks.push(["会话: 搜不存在 → 0", c3.total === 0 && c3.items.length === 0]);
  const cAll = await loadConversations(u1, 1, 20);
  checks.push(["会话: 无 q → 完整列表 2", cAll.total === 2]);

  // —— 图片提示词搜索 ——
  const i1 = await loadImages(u1, { q: "dragon" });
  checks.push(["图片: 搜「dragon」命中 1（仅本人）", i1.total === 1 && i1.items.length === 1 && i1.items[0].prompt.includes("dragon")]);
  const i2 = await loadImages(u1, { q: "cat" });
  checks.push(["图片: 搜「cat」命中 1", i2.total === 1]);
  const i3 = await loadImages(u1, { q: "不存在zzz" });
  checks.push(["图片: 搜不存在 → 0", i3.total === 0]);
  const iAll = await loadImages(u1, {});
  checks.push(["图片: 无 q → 全部 2", iAll.total === 2]);

  // —— Owner-scoped：u2 的同关键词不串到 u1 ——
  const c2dragon = await loadConversations(u1, 1, 20, "gamma");
  checks.push(["会话: u2 的标题(gamma)对 u1 不可见", c2dragon.total === 0]);
  const i2other = await loadImages(u1, { q: "other-user" });
  checks.push(["图片: u2 的提示词(other-user)对 u1 不可见", i2other.total === 0]);

  // —— LIKE 转义：搜「%」不应匹配全部（转义为字面 %）——
  const pct = await loadConversations(u1, 1, 20, "%");
  checks.push(["会话: 搜「%」转义为字面 → 0（非全部）", pct.total === 0]);
  const pctImg = await loadImages(u1, { q: "%" });
  checks.push(["图片: 搜「%」转义为字面 → 0（非全部）", pctImg.total === 0]);

  // —— 大小写不敏感（ILIKE）——
  const ci = await loadImages(u1, { q: "DRAGON" });
  checks.push(["图片: ILIKE 大小写不敏感（DRAGON 命中）", ci.total === 1]);

  // —— 清理 ——
  await sql`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`; // 级联 conv→gen→images

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[search-smoke] ${pass ? "PASS" : "FAIL"} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[search-smoke] FAIL:", e);
  process.exit(1);
});
