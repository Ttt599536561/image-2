// ⑤ 前端接真：读路径 + 兑换写路径端到端冒烟（对真 Neon）。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/reads-smoke.ts
import { randomInt } from "node:crypto";
import { REDEEM_ALPHABET } from "../src/contracts/redeem";
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import { enqueueGeneration } from "../src/server/generation/enqueue";
import { budgetTodayKey } from "../src/server/budget.server";
import { type ProcessDeps, runGenerationJob } from "../src/server/generation/process";
import { redeemCode } from "../src/server/money/redeem.server";
import type { PutResult } from "../src/server/r2.server";
import { isRateLimited, recordRateFailure } from "../src/server/rateLimit";
import {
  deleteImages,
  loadConversationDetail,
  loadConversations,
  loadImages,
  loadInspirations,
  loadMe,
  loadPackages,
  saveImageToLibrary,
} from "../src/server/reads.server";

// 桩：免烧中转/Supabase（各自冒烟已验）。只验「真生成结果」经新读路径正确回流。
const stubDeps = (): ProcessDeps => ({
  callRelay: async () => ({ images: [{ b64_json: "AAAA" }], raw: {} }),
  putToR2: async (uid: string, gid: string): Promise<PutResult> => ({
    storageKey: `readstest/${uid}/${gid}.png`,
    publicUrl: `https://img.test/${gid}.png`,
    contentType: "image/png",
    width: 1024,
    height: 1536,
    sizeBytes: 100,
  }),
});

function genCode(): string {
  let s = "";
  for (let i = 0; i < 18; i++) s += REDEEM_ALPHABET[randomInt(REDEEM_ALPHABET.length)];
  return s;
}

async function main() {
  const sql = getSql();
  const checks: [string, boolean][] = [];

  // 1) 注册（触发原子发放 140mp）。
  const email = `reads+${Date.now()}@example.com`;
  const res = await auth.api.signUpEmail({ body: { email, password: "test123456", name: "reads" } });
  const userId = (res as { user?: { id: string } }).user?.id;
  if (!userId) throw new Error("signUp 未返回 userId");
  console.log(`signUp ${email} -> ${userId}`);

  // 2) loadMe：余额 140 + user 字段齐。
  const me = await loadMe(userId);
  console.log(`loadMe: balance=${me.balanceMp} hasPaid=${me.hasPaid} maxConc=${me.maxConcurrency} email=${me.user.email}`);
  checks.push(["loadMe 余额=140", me.balanceMp === 140]);
  checks.push(["loadMe user.email 对", me.user.email === email]);
  checks.push(["loadMe createdAt 非空", typeof me.user.createdAt === "string" && me.user.createdAt.length > 0]);
  checks.push(["loadMe expiringSoon.mp string codec", typeof me.expiringSoon.mp === "string"]);

  // 3) 读列表空态。
  const conv = await loadConversations(userId);
  const imgs = await loadImages(userId, { range: "all" });
  checks.push(["loadConversations 空", conv.items.length === 0 && conv.total === 0]);
  checks.push(["loadImages 空", imgs.items.length === 0 && imgs.total === 0]);

  // 4) 公共读：套餐 + 灵感（P3-S4：表有 active 卡走表、否则种子；动态品类）。
  const packageId = (await sql`
    INSERT INTO packages(title,price_cash,credits_mp,active)
    VALUES('reads smoke package',100,1000,true)
    RETURNING id`)[0].id as string;
  const pkgs = await loadPackages();
  const insp = await loadInspirations();
  console.log(`loadPackages: ${pkgs.items.length} 档；loadInspirations: ${insp.items.length} 卡 / ${insp.categories.length} 品类`);
  checks.push(["loadPackages ≥1", pkgs.items.length >= 1]);
  checks.push(["loadInspirations ≥1 卡（表或种子）", insp.items.length >= 1]);
  checks.push(["loadInspirations categories 为数组", Array.isArray(insp.categories)]);

  // 5) 兑换写路径：种一个 code → redeemCode → 余额上升 + has_paid。
  const code = genCode();
  const cid = (await sql`
    INSERT INTO redeem_codes(code, credits_value_mp, cash_value, valid_days, status)
    VALUES(${code}, 10000, 990, 30, 'active') RETURNING id`)[0].id as string;
  const r = await redeemCode({ userId, code });
  console.log(`redeem ${code} -> balance=${r.balanceMp} value=${r.creditsValueMp}`);
  checks.push(["redeem 入账 10000", r.creditsValueMp === 10000]);
  checks.push(["redeem 后余额=10140", r.balanceMp === 10140]);
  const me2 = await loadMe(userId);
  checks.push(["redeem 后 hasPaid=true", me2.hasPaid === true]);

  // 6) 重复兑换同码 → 410（已用）。
  let reused = false;
  try {
    await redeemCode({ userId, code });
  } catch (e) {
    reused = (e as { httpStatus?: number }).httpStatus === 410;
  }
  checks.push(["重复兑换 410", reused]);

  // 7) 生成 e2e（新读路径回流）：enqueue → runGenerationJob(桩) → 详情/资产/存入/删除。
  const { generationId, conversationId } = await enqueueGeneration({
    user: { id: userId, maxConcurrency: 2 },
    input: { prompt: "一只戴帽子的柴犬", size: "1024x1536", credentialMode: "system" },
  });
  const outcome = await runGenerationJob(generationId, stubDeps());
  console.log(`generate: ${outcome}`);
  checks.push(["runGenerationJob succeeded", outcome === "succeeded"]);

  const dconv = await loadConversations(userId);
  checks.push(["loadConversations 现 1 条", dconv.items.length === 1 && dconv.items[0].id === conversationId]);

  const dd = await loadConversationDetail(userId, conversationId);
  const gen = dd.generations.find((g) => g.id === generationId);
  checks.push(["详情含该生成", !!gen]);
  checks.push(["生成 status=succeeded", gen?.status === "succeeded"]);
  checks.push(["生成带 image.publicUrl", !!gen?.image?.publicUrl]);
  checks.push(["生成 image.savedToLibrary=false", gen?.image?.savedToLibrary === false]);
  checks.push(["生成 prompt 回流", gen?.prompt === "一只戴帽子的柴犬"]);

  const imgs2 = await loadImages(userId, { range: "all" });
  checks.push(["loadImages 现 1 张", imgs2.items.length === 1 && imgs2.total === 1]);
  checks.push(["loadImages prompt 回流(JOIN generations)", imgs2.items[0]?.prompt === "一只戴帽子的柴犬"]);
  const imageId = imgs2.items[0]?.id;

  await saveImageToLibrary(userId, generationId);
  const imgs3 = await loadImages(userId, { range: "all" });
  checks.push(["存入后 savedToLibrary=true", imgs3.items[0]?.savedToLibrary === true]);

  const del = await deleteImages(userId, [imageId]);
  checks.push(["删除 1 张", del.deleted === 1]);
  const imgs4 = await loadImages(userId, { range: "all" });
  checks.push(["删除后 loadImages 空", imgs4.items.length === 0]);

  // 8) 限流：连记 5 次失败 → isRateLimited('redeem') 命中。
  for (let i = 0; i < 5; i++) await recordRateFailure("redeem", { ip: "9.9.9.9", subject: userId });
  const limited = await isRateLimited("redeem", { ip: "9.9.9.9", subject: userId });
  checks.push(["限流 5 次失败后命中", limited === true]);

  // 9) 清理。
  await sql`DELETE FROM redeem_codes WHERE id=${cid}`;
  await sql`DELETE FROM packages WHERE id=${packageId}`;
  await sql`DELETE FROM events WHERE user_id=${userId} OR payload->>'subject'=${userId}`;
  await sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`; // runGenerationJob 增过当日预算键
  await sql`DELETE FROM users WHERE id=${userId}`; // 级联 credit_*/conversations/generations/images
  await sql`DELETE FROM "user" WHERE id=${userId}`; // 级联 better-auth

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[reads-smoke] ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[reads-smoke] FAIL:", e);
  process.exit(1);
});
