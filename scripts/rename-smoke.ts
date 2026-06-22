// §10 重命名会话冒烟（对真 Neon）：改名生效 + owner-scope（改不动别人的）+ 不存在→404 + 不动 updated_at。
// 不需积分/中转：直接 INSERT conversations 行即可（rename 是纯 owner-scoped UPDATE）。
// 跑：node --env-file=.env --import tsx scripts/rename-smoke.ts
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import {
  loadConversationDetail,
  loadConversations,
  renameConversation,
} from "../src/server/reads.server";

async function newUser(tag: string): Promise<string> {
  const email = `rename-${tag}+${Date.now()}@example.com`;
  const res = await auth.api.signUpEmail({ body: { email, password: "test123456", name: tag } });
  const id = (res as { user?: { id: string } }).user?.id;
  if (!id) throw new Error("signUp 未返回 userId");
  return id;
}

async function main() {
  const sql = getSql();
  const checks: [string, boolean][] = [];

  const userA = await newUser("a");
  const userB = await newUser("b");

  // 直接建一个会话（owner=A，初始标题=「原始标题」）。
  const convId = (await sql`
    INSERT INTO conversations(user_id, title) VALUES(${userA}, '原始标题') RETURNING id`)[0].id as string;
  const updatedAt0 = (await sql`SELECT updated_at FROM conversations WHERE id=${convId}`)[0]
    .updated_at as string;

  // ===== 改名生效 =====
  const r = await renameConversation(userA, convId, "我的新会话名");
  checks.push(["renameConversation 返回新标题", r.title === "我的新会话名"]);
  checks.push([
    "列表里标题已更新",
    (await loadConversations(userA)).items.find((c) => c.id === convId)?.title === "我的新会话名",
  ]);
  checks.push([
    "详情里标题已更新（TopBar 取此）",
    (await loadConversationDetail(userA, convId)).title === "我的新会话名",
  ]);

  // 不动 updated_at（改名不应把会话顶到「最近」最前）。
  const updatedAt1 = (await sql`SELECT updated_at FROM conversations WHERE id=${convId}`)[0]
    .updated_at as string;
  checks.push([
    "改名不动 updated_at",
    new Date(updatedAt0).getTime() === new Date(updatedAt1).getTime(),
  ]);

  // ===== owner-scope：B 改不动 A 的会话（0 行 → 404） =====
  let b404 = false;
  try {
    await renameConversation(userB, convId, "黑客改名");
  } catch (e) {
    b404 = (e as Response)?.status === 404;
  }
  checks.push(["owner-scope：B 改 A 会话 → 404", b404]);
  checks.push([
    "A 标题未被 B 篡改",
    (await loadConversationDetail(userA, convId)).title === "我的新会话名",
  ]);

  // ===== 不存在的 id → 404 =====
  let missing404 = false;
  try {
    await renameConversation(userA, "00000000-0000-0000-0000-000000000000", "x");
  } catch (e) {
    missing404 = (e as Response)?.status === 404;
  }
  checks.push(["不存在的会话 → 404", missing404]);

  // ===== 清理 =====
  await sql`DELETE FROM conversations WHERE id=${convId}`;
  for (const uid of [userA, userB]) {
    await sql`DELETE FROM events WHERE user_id=${uid}`;
    await sql`DELETE FROM users WHERE id=${uid}`;
    await sql`DELETE FROM "user" WHERE id=${uid}`;
  }

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[rename-smoke] ${pass ? "PASS" : "FAIL"}（${checks.length} 项）`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[rename-smoke] FAIL:", e);
  process.exit(1);
});
