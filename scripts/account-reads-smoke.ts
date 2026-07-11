// #8 账号页读路径冒烟（对真 Neon）：loadLots（多来源批次）/ loadLedger（类型筛）/ loadRedemptions（兑换记录）。
// 制造 signup(注册) + code(兑换) + adjust(±) + debit(生成) 全谱数据，校验读路径正确。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/account-reads-smoke.ts
import { randomInt } from "node:crypto";
import { REDEEM_ALPHABET } from "../src/contracts/redeem";
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import { budgetTodayKey } from "../src/server/budget.server";
import { enqueueGeneration } from "../src/server/generation/enqueue";
import { type ProcessDeps, runGenerationJob } from "../src/server/generation/process";
import { adjustCredit } from "../src/server/money/adjust.server";
import { redeemCode } from "../src/server/money/redeem.server";
import type { PutResult } from "../src/server/r2.server";
import { loadLedger, loadLots, loadMe, loadRedemptions } from "../src/server/reads.server";

const stubDeps = (): ProcessDeps => ({
  callRelay: async () => ({ images: [{ b64_json: "AAAA" }], raw: {} }),
  putToR2: async (uid: string, gid: string): Promise<PutResult> => ({
    storageKey: `acctest/${uid}/${gid}.png`,
    publicUrl: `https://img.test/${gid}.png`,
    contentType: "image/png",
    width: 1024,
    height: 1024,
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

  // 注册 → signup lot(140) + grant ledger。
  const email = `acct+${Date.now()}@example.com`;
  const su = await auth.api.signUpEmail({ body: { email, password: "test123456", name: "acct" } });
  const userId = (su as { user?: { id: string } }).user?.id;
  if (!userId) throw new Error("signUp 未返回 userId");
  const adminId = ((await auth.api.signUpEmail({
    body: { email: `acct-admin+${Date.now()}@example.com`, password: "test123456", name: "adm" },
  })) as { user?: { id: string } }).user?.id as string;

  // 兑换 → code lot(100000) + credit ledger（面值 990 / 30 天）。
  const code = genCode();
  const cid = (await sql`
    INSERT INTO redeem_codes(code, credits_value_mp, cash_value, valid_days, status)
    VALUES(${code}, 100000, 990, 30, 'active') RETURNING id`)[0].id as string;
  await redeemCode({ userId, code });

  // 管理员 +5000（adjust lot 永久）/ -3000（FIFO 扣，adjust ledger，方向落 reason 前缀）。
  await adjustCredit({ adminId, userId, deltaMp: 5000, reason: "活动补偿", validDays: null });
  await adjustCredit({ adminId, userId, deltaMp: -3000, reason: "误充扣回" });

  // 生成 → debit ledger（成功才扣）。
  const { generationId } = await enqueueGeneration({
    user: { id: userId, maxConcurrency: 2 },
    input: { prompt: "账号页冒烟", size: "1024x1024", credentialMode: "system" },
  });
  await runGenerationJob(generationId, stubDeps());

  // ===== loadLots =====
  const lots = await loadLots(userId);
  const sources = new Set(lots.items.map((l) => l.source));
  checks.push(["lots ≥3 批次", lots.total >= 3]);
  checks.push(["lots 含 signup/code/adjust 三来源", sources.has("signup") && sources.has("code") && sources.has("adjust")]);
  const adjustLot = lots.items.find((l) => l.source === "adjust");
  checks.push(["adjust 批次 granted=5000", adjustLot?.grantedMp === 5000]);
  checks.push(["adjust 批次永久（expiresAt=null）", adjustLot?.expiresAt === null]);
  const codeLot = lots.items.find((l) => l.source === "code");
  checks.push(["code 批次有到期日", typeof codeLot?.expiresAt === "string"]);

  // ===== loadLedger 全部 + 类型筛 =====
  const all = await loadLedger(userId, 1, 50);
  const types = new Set(all.items.map((i) => i.entryType));
  checks.push(["ledger 含 grant/credit/adjust/debit", ["grant", "credit", "adjust", "debit"].every((t) => types.has(t))]);
  const credits = await loadLedger(userId, 1, 50, "credit");
  checks.push(["type=credit 仅 credit", credits.items.length > 0 && credits.items.every((i) => i.entryType === "credit")]);
  const debits = await loadLedger(userId, 1, 50, "debit");
  checks.push(["type=debit 仅 debit", debits.items.length === 1 && debits.items[0].entryType === "debit"]);
  checks.push(["debit 金额=70", debits.items[0]?.amountMp === 70]);
  const adjustLedger = await loadLedger(userId, 1, 50, "adjust");
  checks.push(["adjust 流水 2 条", adjustLedger.items.length === 2]);
  checks.push([
    "adjust 方向编码在 reason 前缀（+/-）",
    adjustLedger.items.some((i) => (i.reason ?? "").trimStart().startsWith("+")) &&
      adjustLedger.items.some((i) => (i.reason ?? "").trimStart().startsWith("-")),
  ]);

  // ===== loadRedemptions =====
  const reds = await loadRedemptions(userId);
  checks.push(["兑换记录 1 条", reds.total === 1 && reds.items.length === 1]);
  checks.push(["兑换 amount=100000", reds.items[0]?.amountMp === 100000]);
  checks.push(["兑换 cashValue=990", reds.items[0]?.cashValue === 990]);
  checks.push(["兑换 validDays=30", reds.items[0]?.validDays === 30]);
  checks.push(["兑换码已脱敏（含 …）", (reds.items[0]?.code ?? "").includes("…")]);

  // ===== loadMe 余额自洽（140+100000+5000-3000-70=102070）=====
  const me = await loadMe(userId);
  checks.push(["余额=102070", me.balanceMp === 102070]);

  // 清理
  await sql`DELETE FROM redeem_codes WHERE id=${cid}`;
  for (const uid of [userId, adminId]) {
    await sql`DELETE FROM events WHERE user_id=${uid} OR payload->>'subject'=${uid}`;
    await sql`DELETE FROM audit_log WHERE admin_id=${uid}`;
    await sql`DELETE FROM users WHERE id=${uid}`;
    await sql`DELETE FROM "user" WHERE id=${uid}`;
  }
  await sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[account-reads-smoke] ${pass ? "PASS" : "FAIL"}（${checks.length} 项）`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[account-reads-smoke] FAIL:", e);
  process.exit(1);
});
