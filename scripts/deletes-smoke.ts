// Wave C 删除路径冒烟（对真 Neon）：#3 删会话（级联+owner-scope）+ #12 后台删生成记录（硬删+审计+账本保留）。
// R2 用桩 key（deleteManyFromR2 对不存在 key 是幂等 no-op，不烧真对象）。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/deletes-smoke.ts
import { randomInt } from "node:crypto";
import { REDEEM_ALPHABET } from "../src/contracts/redeem";
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import { budgetTodayKey } from "../src/server/budget.server";
import { deleteGenerations } from "../src/server/admin/generations.server";
import { enqueueGeneration } from "../src/server/generation/enqueue";
import { type ProcessDeps, runGenerationJob } from "../src/server/generation/process";
import { redeemCode } from "../src/server/money/redeem.server";
import type { PutResult } from "../src/server/r2.server";
import {
  deleteConversations,
  loadConversationDetail,
  loadConversations,
  loadImages,
} from "../src/server/reads.server";

const stubDeps = (): ProcessDeps => ({
  callRelay: async () => ({ images: [{ b64_json: "AAAA" }], raw: {} }),
  putToR2: async (uid: string, gid: string): Promise<PutResult> => ({
    storageKey: `deltest/${uid}/${gid}.png`,
    publicUrl: `https://img.test/${gid}.png`,
    contentType: "image/png",
    width: 1024,
    height: 1024,
    sizeBytes: 100,
  }),
});

async function newUser(tag: string): Promise<string> {
  const email = `del-${tag}+${Date.now()}@example.com`;
  const res = await auth.api.signUpEmail({ body: { email, password: "test123456", name: tag } });
  const id = (res as { user?: { id: string } }).user?.id;
  if (!id) throw new Error("signUp 未返回 userId");
  return id;
}

function genCode(): string {
  let s = "";
  for (let i = 0; i < 18; i++) s += REDEEM_ALPHABET[randomInt(REDEEM_ALPHABET.length)];
  return s;
}

/** 给用户充值（注册仅 140mp=2 张，本冒烟某些用户要跑多张）。返回 code id 供清理。 */
async function topUp(userId: string): Promise<string> {
  const sql = getSql();
  const code = genCode();
  const cid = (await sql`
    INSERT INTO redeem_codes(code, credits_value_mp, cash_value, valid_days, status)
    VALUES(${code}, 100000, 990, 30, 'active') RETURNING id`)[0].id as string;
  await redeemCode({ userId, code });
  return cid;
}

async function makeGeneration(userId: string): Promise<{ conversationId: string; generationId: string }> {
  const { generationId, conversationId } = await enqueueGeneration({
    user: { id: userId, maxConcurrency: 2 },
    input: { prompt: "测试删除路径", size: "1024x1024", credentialMode: "system" },
  });
  const outcome = await runGenerationJob(generationId, stubDeps());
  if (outcome !== "succeeded") throw new Error(`runGenerationJob 非 succeeded: ${outcome}`);
  return { conversationId, generationId };
}

async function main() {
  const sql = getSql();
  const checks: [string, boolean][] = [];

  const userA = await newUser("a");
  const userB = await newUser("b");
  const adminId = await newUser("admin");
  const codeA = await topUp(userA); // A 要跑 3 张（g1/g3/g4），注册 140 不够 → 充值

  // ===== #3 删会话：级联 generations→images + owner-scope =====
  const g1 = await makeGeneration(userA);
  checks.push(["A: 1 会话", (await loadConversations(userA)).total === 1]);
  checks.push(["A: 1 图", (await loadImages(userA, { range: "all" })).total === 1]);

  // owner-scope：B 删不掉 A 的会话。
  const wrongDel = await deleteConversations(userB, [g1.conversationId]);
  checks.push(["owner-scope：B 删 A 会话 deleted=0", wrongDel.deleted === 0]);
  checks.push(["A 会话仍在", (await loadConversations(userA)).total === 1]);

  // 正主删除 → 级联清生成+图。
  const okDel = await deleteConversations(userA, [g1.conversationId]);
  checks.push(["A 删自己会话 deleted=1", okDel.deleted === 1]);
  checks.push(["删后 A 0 会话", (await loadConversations(userA)).total === 0]);
  checks.push(["删后 A 0 图（级联）", (await loadImages(userA, { range: "all" })).total === 0]);
  const genGone =
    ((await sql`SELECT COUNT(*)::int AS n FROM generations WHERE id=${g1.generationId}`) as { n: number }[])[0]
      .n === 0;
  checks.push(["删后 generations 行没了（级联）", genGone]);
  let detail404 = false;
  try {
    await loadConversationDetail(userA, g1.conversationId);
  } catch (e) {
    detail404 = (e as Response)?.status === 404;
  }
  checks.push(["删后详情 404", detail404]);
  // 账本保留（删会话不退款，debit 流水还在）。
  const ledgerAfterConvDel =
    ((await sql`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE ref_id=${g1.generationId} AND entry_type='debit'`) as {
      n: number;
    }[])[0].n;
  checks.push(["删会话后 debit 账本保留", ledgerAfterConvDel === 1]);

  // ===== #12 后台删生成记录：硬删 + 清 R2 + 审计 + 账本保留 =====
  const g2 = await makeGeneration(userB);
  checks.push(["B: 1 图", (await loadImages(userB, { range: "all" })).total === 1]);

  const adminDel = await deleteGenerations({ adminId, ids: [g2.generationId], ip: "1.2.3.4" });
  checks.push(["admin 删生成 deleted=1", adminDel.deleted === 1]);
  const g2Gone =
    ((await sql`SELECT COUNT(*)::int AS n FROM generations WHERE id=${g2.generationId}`) as { n: number }[])[0]
      .n === 0;
  checks.push(["admin 删后 generations 没了", g2Gone]);
  checks.push(["admin 删后 B 0 图（级联）", (await loadImages(userB, { range: "all" })).total === 0]);
  // 审计留痕。
  const auditN =
    ((await sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE admin_id=${adminId} AND action='delete_generation' AND target_id=${g2.generationId}`) as {
      n: number;
    }[])[0].n;
  checks.push(["admin 删生成写审计", auditN === 1]);
  // 账本保留（对账走 credit_lots，不受删除影响）。
  const ledgerAfterGenDel =
    ((await sql`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE ref_id=${g2.generationId} AND entry_type='debit'`) as {
      n: number;
    }[])[0].n;
  checks.push(["admin 删生成后 debit 账本保留", ledgerAfterGenDel === 1]);

  // 批删（空集 / 多条）：建两条 → 批删 deleted=2。
  const g3 = await makeGeneration(userA);
  const g4 = await makeGeneration(userA);
  const batchDel = await deleteGenerations({
    adminId,
    ids: [g3.generationId, g4.generationId],
    ip: "1.2.3.4",
  });
  checks.push(["批删 deleted=2", batchDel.deleted === 2]);
  const batchAuditN =
    ((await sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE admin_id=${adminId} AND action='delete_generations_batch'`) as {
      n: number;
    }[])[0].n;
  checks.push(["批删写审计(batch)", batchAuditN === 1]);

  // ===== 清理 =====
  await sql`DELETE FROM redeem_codes WHERE id=${codeA}`;
  for (const uid of [userA, userB, adminId]) {
    await sql`DELETE FROM events WHERE user_id=${uid} OR payload->>'subject'=${uid}`;
    await sql`DELETE FROM audit_log WHERE admin_id=${uid}`;
    await sql`DELETE FROM users WHERE id=${uid}`;
    await sql`DELETE FROM "user" WHERE id=${uid}`;
  }
  await sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[deletes-smoke] ${pass ? "PASS" : "FAIL"}（${checks.length} 项）`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[deletes-smoke] FAIL:", e);
  process.exit(1);
});
