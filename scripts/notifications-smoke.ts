// §9 后台广播公告冒烟（对真 Neon）：广播→目标用户 notifications 出现、非目标不出现、同一公告(同 aid)复发幂等不重复、
// loadNotifications owner-scoped（只见本人通知）。清理按公告 aid 前缀删（含「全体」广播波及的其他用户行）+ 删测试用户。
// 跑：node --env-file=.env --import tsx scripts/notifications-smoke.ts
import { randomUUID } from "node:crypto";
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";
import {
  broadcastAnnouncement,
  notificationTargetCounts,
} from "../src/server/admin/notifications.server";
import { loadNotifications } from "../src/server/reads.server";

async function newUser(tag: string): Promise<string> {
  const email = `notif-${tag}+${Date.now()}@example.com`;
  const res = await auth.api.signUpEmail({ body: { email, password: "test123456", name: tag } });
  const id = (res as { user?: { id: string } }).user?.id;
  if (!id) throw new Error("signUp 未返回 userId");
  return id;
}

type Item = { type: string; payload: Record<string, unknown> | null };
const annItems = (items: Item[]) => items.filter((i) => i.type === "announcement");

async function main() {
  const sql = getSql();
  const checks: [string, boolean][] = [];

  const adminId = await newUser("admin");
  const userPaid = await newUser("paid");
  const userFree = await newUser("free");
  await sql`UPDATE users SET has_paid = true WHERE id = ${userPaid}`;

  // counts 合理性。
  const counts = await notificationTargetCounts();
  checks.push(["counts.paid ≥ 1", counts.paid >= 1]);
  checks.push(["counts.all ≥ counts.paid", counts.all >= counts.paid]);

  // ===== 广播 target=paid =====
  const bp = await broadcastAnnouncement({
    adminId,
    title: "付费公告",
    body: "仅付费可见",
    link: "/billing",
    target: "paid",
  });
  checks.push(["paid 广播 inserted ≥ 1", bp.inserted >= 1]);
  const paid1 = annItems((await loadNotifications(userPaid, false)).items);
  const free1 = annItems((await loadNotifications(userFree, false)).items);
  checks.push(["付费用户收到公告", paid1.length === 1]);
  checks.push(["非付费用户未收到（target=paid）", free1.length === 0]);
  checks.push(["公告 payload.title 正确", paid1[0]?.payload?.title === "付费公告"]);
  checks.push(["公告 payload.link 正确", paid1[0]?.payload?.link === "/billing"]);

  // ===== 广播 target=all =====
  const ba = await broadcastAnnouncement({ adminId, title: "全员公告", body: "大家好", target: "all" });
  checks.push(["all 广播 inserted ≥ 2（≥ paid+free+admin）", ba.inserted >= 2]);
  const paid2 = annItems((await loadNotifications(userPaid, false)).items);
  const free2 = annItems((await loadNotifications(userFree, false)).items);
  checks.push(["付费用户现有 2 条公告（paid+all）", paid2.length === 2]);
  checks.push(["非付费用户现有 1 条公告（仅 all）", free2.length === 1]);

  // ===== owner-scoped：free 只见发给自己的公告，绝不见「付费公告」 =====
  const freeTitles = free2.map((i) => i.payload?.title);
  checks.push([
    "owner-scoped：free 只见全员公告、不见付费公告",
    freeTitles.length === 1 && freeTitles[0] === "全员公告",
  ]);

  // ===== 幂等：同一公告(同 aid)复发不重复插（dedupe_key 唯一 + ON CONFLICT DO NOTHING）=====
  const aid = randomUUID();
  const payload = JSON.stringify({ title: "幂等公告", body: "x", link: null });
  const run = () =>
    sql`
      INSERT INTO notifications(user_id, type, payload, dedupe_key)
      SELECT id, 'announcement', ${payload}::jsonb, 'announcement:' || ${aid} || ':' || id::text
      FROM users WHERE id = ${userFree}
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id` as Promise<unknown[]>;
  const first = await run();
  const second = await run();
  checks.push(["首次插入 1 行", first.length === 1]);
  checks.push(["复发（同 aid）插入 0 行（dedupe）", second.length === 0]);

  // ===== 清理：按 aid 前缀删（含「全体」广播波及的其他用户行）+ 删测试用户 =====
  for (const a of [bp.announcementId, ba.announcementId, aid]) {
    await sql`DELETE FROM notifications WHERE dedupe_key LIKE ${`announcement:${a}:%`}`;
  }
  for (const uid of [adminId, userPaid, userFree]) {
    await sql`DELETE FROM notifications WHERE user_id = ${uid}`;
    await sql`DELETE FROM audit_log WHERE admin_id = ${uid}`;
    await sql`DELETE FROM events WHERE user_id = ${uid}`;
    await sql`DELETE FROM users WHERE id = ${uid}`;
    await sql`DELETE FROM "user" WHERE id = ${uid}`;
  }

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[notifications-smoke] ${pass ? "PASS" : "FAIL"}（${checks.length} 项）`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[notifications-smoke] FAIL:", e);
  process.exit(1);
});
