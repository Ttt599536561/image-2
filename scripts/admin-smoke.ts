// ⑥ 后台：admin server 函数对真 Neon 端到端冒烟（直接调 server 函数，免起 HTTP/admin 会话）。
// 跑：node --env-file=.env --import tsx scripts/admin-smoke.ts
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import { listAudit } from "../src/server/admin/audit.server";
import {
  batchReconcile,
  disableBatch,
  exportBatchCsv,
  generateCodes,
  getCodeStatus,
  listBatches,
} from "../src/server/admin/codes.server";
import { getAllConfig, updateConfig } from "../src/server/admin/config.server";
import { loadDashboard } from "../src/server/admin/dashboard.server";
import { listGenerations } from "../src/server/admin/generations.server";
import {
  createInspiration,
  deleteInspiration,
  listAllInspirations,
  updateInspiration,
} from "../src/server/admin/inspirations.server";
import { createPackage, listAllPackages, softDeletePackage, updatePackage } from "../src/server/admin/packages.server";
import { getUserDetail, searchUsers, setBanned, setConcurrency } from "../src/server/admin/users.server";
import { adjustCredit } from "../src/server/money/adjust.server";
import { loadInspirations } from "../src/server/reads.server";

async function reg(tag: string): Promise<{ id: string; email: string }> {
  const email = `${tag}+${Date.now()}_${Math.floor(performance.now())}@example.com`;
  const r = await auth.api.signUpEmail({ body: { email, password: "test123456", name: tag } });
  const id = (r as { user?: { id: string } }).user?.id;
  if (!id) throw new Error(`signUp ${tag} 未返回 id`);
  return { id, email };
}

async function main() {
  const sql = getSql();
  const checks: [string, boolean][] = [];
  const PKG_ENTRY = "00000000-0000-4000-a000-000000000001"; // seed 入门包

  const admin = await reg("admin");
  const target = await reg("target");
  await sql`UPDATE users SET role='admin' WHERE id=${admin.id}`;
  console.log(`admin=${admin.email} target=${target.email}`);

  // —— 兑换码 ——
  const gen = await generateCodes({ adminId: admin.id, packageId: PKG_ENTRY, count: 3, ip: "1.1.1.1" });
  checks.push(["generateCodes 出 3 码", gen.count === 3]);
  const batches = await listBatches();
  checks.push(["listBatches 含新批次", batches.items.some((b) => b.batchId === gen.batchId && b.total === 3)]);
  const codeRow = (await sql`SELECT code FROM redeem_codes WHERE batch_id=${gen.batchId} LIMIT 1`)[0] as { code: string };
  const cs = await getCodeStatus(codeRow.code);
  checks.push(["getCodeStatus active + 快照 10000mp/990分", cs?.status === "active" && cs?.creditsValueMp === 10000 && cs?.cashValue === 990]);
  const rec1 = await batchReconcile(gen.batchId);
  checks.push(["对账 issued=3 unused=3", rec1.issued === 3 && rec1.unused === 3 && rec1.used === 0]);
  const csv = await exportBatchCsv(gen.batchId);
  checks.push(["CSV BOM + 3 行 + header", csv.csv.startsWith("﻿") && csv.csv.trim().split("\n").length === 4]);
  const dis = await disableBatch({ adminId: admin.id, batchId: gen.batchId, ip: "1.1.1.1" });
  checks.push(["disableBatch 作废 3", dis.disabled === 3]);
  const cs2 = await getCodeStatus(codeRow.code);
  checks.push(["作废后 getCodeStatus=disabled", cs2?.status === "disabled"]);

  // —— 用户 ——
  const found = await searchUsers(target.email);
  checks.push(["searchUsers 命中 target", found.items.some((u) => u.id === target.id)]);
  await setConcurrency({ adminId: admin.id, userId: target.id, maxConcurrency: 5, ip: "1.1.1.1" });
  await setBanned({ adminId: admin.id, userId: target.id, banned: true, reason: "测试", ip: "1.1.1.1" });
  const det = await getUserDetail(target.id);
  checks.push(["setConcurrency=5", det.user.maxConcurrency === 5]);
  checks.push(["setBanned 后 is_banned", det.user.isBanned === true]);
  checks.push(["详情余额 140 + stats", det.user.balanceMp === 140 && det.stats.conversations === 0]);

  // —— 调积分（调 ③）——
  const a1 = await adjustCredit({ adminId: admin.id, userId: target.id, deltaMp: 5000, reason: "补偿", ip: "1.1.1.1" });
  const a2 = await adjustCredit({ adminId: admin.id, userId: target.id, deltaMp: -2000, reason: "扣回", ip: "1.1.1.1" });
  checks.push(["adjust +5000 → 5140", a1.after === 5140]);
  checks.push(["adjust -2000 → 3140", a2.after === 3140]);
  const det2 = await getUserDetail(target.id);
  checks.push(["详情流水含 2 笔 adjust", det2.ledger.filter((l) => l.entryType === "adjust").length === 2]);

  // —— 套餐 ——
  const pkg = await createPackage({
    adminId: admin.id,
    fields: { title: "冒烟包", description: "测试", priceCash: 1990, creditsMp: 20000, validDays: 90, sort: 99 },
    ip: "1.1.1.1",
  });
  const allPkg = await listAllPackages();
  checks.push(["createPackage + listAllPackages 含它", allPkg.items.some((p) => p.id === pkg.id && p.priceCash === 1990)]);
  await updatePackage({ adminId: admin.id, id: pkg.id, fields: { title: "冒烟包2", priceCash: 2990, creditsMp: 30000, validDays: null }, ip: "1.1.1.1" });
  await softDeletePackage({ adminId: admin.id, id: pkg.id, ip: "1.1.1.1" });
  const allPkg2 = await listAllPackages();
  const p2 = allPkg2.items.find((p) => p.id === pkg.id);
  checks.push(["update+软删 → title2/active=false/永久", p2?.title === "冒烟包2" && p2?.active === false && p2?.validDays === null]);

  // —— 全局参数（改后还原）——
  const cfg0 = await getAllConfig();
  const price0 = cfg0.items.find((c) => c.key === "price_per_image_mp")?.value ?? 70;
  checks.push(["getAllConfig 8 键", cfg0.items.length === 8]);
  await updateConfig({ adminId: admin.id, updates: [{ key: "price_per_image_mp", value: 80 }], ip: "1.1.1.1" });
  const cfg1 = await getAllConfig();
  checks.push(["updateConfig price=80", cfg1.items.find((c) => c.key === "price_per_image_mp")?.value === 80]);
  let cfgRejected = false;
  try {
    await updateConfig({ adminId: admin.id, updates: [{ key: "default_max_concurrency", value: 0 }], ip: "1.1.1.1" });
  } catch (e) {
    cfgRejected = (e as { status?: number }).status === 400;
  }
  checks.push(["updateConfig 违约(并发=0) 拒 400", cfgRejected]);
  await updateConfig({ adminId: admin.id, updates: [{ key: "price_per_image_mp", value: price0 }], ip: "1.1.1.1" }); // 还原

  // —— 灵感库（表已迁）——
  const insp = await createInspiration({
    adminId: admin.id,
    fields: { title: "冒烟灵感", cover: "https://img.test/x.png", category: "海报", prompt: "测试提示词", summary: "一行" },
    ip: "1.1.1.1",
  });
  const inspList = await listAllInspirations();
  checks.push(["createInspiration + 列表含它", inspList.items.some((i) => i.id === insp.id)]);
  const pub = await loadInspirations();
  checks.push(["loadInspirations 回流表内容(含冒烟灵感)", pub.items.some((i) => i.id === insp.id)]);
  await updateInspiration({ adminId: admin.id, id: insp.id, fields: { title: "冒烟灵感2", cover: "https://img.test/y.png", prompt: "测试提示词", active: false }, ip: "1.1.1.1" });
  const pub2 = await loadInspirations();
  checks.push(["下架后 loadInspirations 不含它", !pub2.items.some((i) => i.id === insp.id)]);
  await deleteInspiration({ adminId: admin.id, id: insp.id, ip: "1.1.1.1" });
  const inspList2 = await listAllInspirations();
  checks.push(["deleteInspiration 后列表无它", !inspList2.items.some((i) => i.id === insp.id)]);

  // —— 生成记录 + 看板 + 审计 ——
  const gens = await listGenerations({});
  checks.push(["listGenerations 返回结构", Array.isArray(gens.items) && typeof gens.total === "number"]);
  const dash = await loadDashboard();
  checks.push(["dashboard SUM 走 string", typeof dash.liabilityMp === "string" && typeof dash.totalRevenueCash === "string"]);
  checks.push(["dashboard 队列/计数 number", typeof dash.queueQueued === "number" && typeof dash.totalUsers === "number"]);
  const audit = await listAudit({});
  const myActions = audit.items.filter((a) => a.adminId === admin.id).map((a) => a.action);
  const want = ["gen_codes", "disable_batch", "set_concurrency", "ban", "adjust_credit", "create_package", "edit_package", "delete_package", "edit_config", "create_inspiration", "edit_inspiration", "delete_inspiration"];
  const missing = want.filter((w) => !myActions.includes(w));
  checks.push([`审计含全部敏感写动作${missing.length ? " 缺:" + missing.join(",") : ""}`, missing.length === 0]);

  // —— 清理 ——
  await sql`DELETE FROM audit_log WHERE admin_id=${admin.id}`;
  await sql`DELETE FROM redeem_codes WHERE batch_id=${gen.batchId}`;
  await sql`DELETE FROM packages WHERE id=${pkg.id}`;
  await sql`DELETE FROM events WHERE user_id IN (${admin.id}, ${target.id})`;
  await sql`DELETE FROM users WHERE id IN (${admin.id}, ${target.id})`;
  await sql`DELETE FROM "user" WHERE id IN (${admin.id}, ${target.id})`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[admin-smoke] ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[admin-smoke] FAIL:", e);
  process.exit(1);
});
