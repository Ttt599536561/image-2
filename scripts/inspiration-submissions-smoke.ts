// 灵感投稿端到端冒烟（真 Neon；copy 注入桩免烧 Supabase）。§13.1。
// 覆盖：submit(落 pending+副本/同图去重/越权 404) · approve(建上架卡+署名+复用副本+通知+终态幂等) · reject(原因+通知)。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/inspiration-submissions-smoke.ts
import { randomUUID } from "node:crypto";
import { getSql } from "../src/db/db.server";
import {
  approveSubmission,
  countPendingSubmissions,
  listSubmissions,
  rejectSubmission,
} from "../src/server/admin/inspirationReview.server";
import { listMySubmissions, submitInspiration } from "../src/server/inspirationSubmissions.server";

const sql = getSql();
const checks: [string, boolean][] = [];
const userIds: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO users(id,email,max_concurrency) VALUES (${id}, ${`isub+${id.slice(0, 12)}@example.com`}, 2)`;
  await sql`INSERT INTO credit_accounts(user_id,balance_mp) VALUES (${id}, 0)`;
  userIds.push(id);
  return id;
}

async function mkImage(userId: string): Promise<{ imageId: string }> {
  const convId = randomUUID();
  const genId = randomUUID();
  const imageId = randomUUID();
  const storageKey = `${userId}/2026/06/${genId}-smoke.png`;
  await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${userId}, 'insp-sub')`;
  await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status)
            VALUES (${genId}, ${convId}, ${userId}, 'orig prompt', 'auto', 'succeeded')`;
  await sql`INSERT INTO images(id,generation_id,user_id,storage_key,public_url,width,height)
            VALUES (${imageId}, ${genId}, ${userId}, ${storageKey}, ${`https://x/${storageKey}`}, 1024, 1024)`;
  return { imageId };
}

// copy 桩：返回一个 inspirations/submissions/… 副本 key/url（不碰存储）。
const copyStub = async (_srcKey: string, userId: string) => ({
  storageKey: `inspirations/submissions/${userId}/smoke/${randomUUID()}.png`,
  publicUrl: `https://img.test/inspirations/submissions/${userId}/${randomUUID()}.png`,
});

async function main(): Promise<void> {
  const uid = await mkUser();
  const adminId = await mkUser(); // 充当审核管理员（audit_log.admin_id FK 即可，不必 role=admin）

  // ===== 1) submit：落 pending + 副本 key =====
  const { imageId } = await mkImage(uid);
  const r1 = await submitInspiration(
    uid,
    { imageId, title: "T1", prompt: "P1", category: "海报", summary: "S1" },
    { copy: copyStub },
  );
  const [row] = (await sql`SELECT * FROM inspiration_submissions WHERE id=${r1.id}`) as Record<string, unknown>[];
  checks.push([
    "submit: 落 pending 行 + image_key=副本(inspirations/submissions/…)",
    r1.status === "pending" &&
      row?.status === "pending" &&
      String(row?.image_key ?? "").startsWith(`inspirations/submissions/${uid}/`) &&
      Number(row?.width) === 1024,
  ]);

  // ===== 2) 同图去重（pending 存在）=====
  let dupErr = false;
  try {
    await submitInspiration(uid, { imageId, title: "T1b", prompt: "P" }, { copy: copyStub });
  } catch {
    dupErr = true;
  }
  checks.push(["submit: 同图重复投稿被拒", dupErr]);

  // ===== 3) 越权：投他人图 → 404 =====
  const other = await mkUser();
  const { imageId: othersImg } = await mkImage(other);
  let ownErr = false;
  try {
    await submitInspiration(uid, { imageId: othersImg, title: "x", prompt: "y" }, { copy: copyStub });
  } catch {
    ownErr = true;
  }
  checks.push(["submit: 投他人图被拒(404)", ownErr]);

  // ===== 4) approve：建上架卡 + 署名 + 复用副本 + 通知 + 终态幂等 =====
  const appr = await approveSubmission({
    adminId,
    id: r1.id,
    fields: { title: "T1-edited", prompt: "P1", category: "海报", summary: "S1", active: true },
  });
  const [insp] = (await sql`SELECT * FROM inspirations WHERE id=${appr.inspirationId}`) as Record<string, unknown>[];
  const [sub1] = (await sql`SELECT * FROM inspiration_submissions WHERE id=${r1.id}`) as Record<string, unknown>[];
  const notif = (await sql`
    SELECT payload FROM notifications WHERE user_id=${uid} AND type='inspiration_reviewed'
      AND dedupe_key=${`inspiration_reviewed:${r1.id}`}`) as Array<{ payload: Record<string, unknown> }>;
  checks.push([
    "approve: 建 inspirations 上架卡(active + 署名 + submitted_by)",
    insp?.active === true &&
      insp?.title === "T1-edited" &&
      typeof insp?.submitter_name === "string" &&
      String(insp?.submitter_name).length > 0 &&
      insp?.submitted_by === uid,
  ]);
  checks.push([
    "approve: cover 复用投稿副本对象(cover_key=image_key)",
    insp?.cover_key === sub1?.image_key && insp?.cover_url === sub1?.image_url,
  ]);
  checks.push([
    "approve: 投稿置 approved + published_inspiration_id",
    sub1?.status === "approved" && sub1?.published_inspiration_id === appr.inspirationId,
  ]);
  checks.push([
    "approve: 通知投稿人 inspiration_reviewed(approved)",
    notif.length === 1 && notif[0].payload?.status === "approved",
  ]);
  let reErr = false;
  try {
    await approveSubmission({ adminId, id: r1.id, fields: { title: "x", prompt: "y" } });
  } catch {
    reErr = true;
  }
  checks.push(["approve: 已审核再 approve 被拒(终态)", reErr]);

  // ===== 5) reject：置 rejected + 原因 + 通知 =====
  const { imageId: img2 } = await mkImage(uid);
  const r2 = await submitInspiration(uid, { imageId: img2, title: "T2", prompt: "P2" }, { copy: copyStub });
  await rejectSubmission({ adminId, id: r2.id, reason: "画面不清晰" });
  const [sub2] = (await sql`SELECT * FROM inspiration_submissions WHERE id=${r2.id}`) as Record<string, unknown>[];
  const notif2 = (await sql`
    SELECT payload FROM notifications WHERE user_id=${uid}
      AND dedupe_key=${`inspiration_reviewed:${r2.id}`}`) as Array<{ payload: Record<string, unknown> }>;
  checks.push(["reject: 置 rejected + 记原因", sub2?.status === "rejected" && sub2?.review_reason === "画面不清晰"]);
  checks.push([
    "reject: 通知投稿人(rejected + reason)",
    notif2.length === 1 && notif2[0].payload?.status === "rejected" && notif2[0].payload?.reason === "画面不清晰",
  ]);

  // ===== 6) listMine / listSubmissions / count 健全 =====
  const mine = await listMySubmissions(uid);
  checks.push(["listMine: 返回本人投稿(≥2)", mine.items.length >= 2]);
  const q = await listSubmissions({ status: "approved" });
  checks.push(["listSubmissions: 含 pending 计数 + items 数组", typeof q.pending === "number" && Array.isArray(q.items)]);
  checks.push(["count: countPendingSubmissions 为 number", typeof (await countPendingSubmissions()) === "number"]);

  // ===== 7) 上架卡删除后允许重投同图（审查 confirmed#3）=====
  const { imageId: img3 } = await mkImage(uid);
  const r3 = await submitInspiration(uid, { imageId: img3, title: "T3", prompt: "P3" }, { copy: copyStub });
  const appr3 = await approveSubmission({ adminId, id: r3.id, fields: { title: "T3", prompt: "P3" } });
  let blockedWhileLive = false;
  try {
    await submitInspiration(uid, { imageId: img3, title: "T3b", prompt: "P3" }, { copy: copyStub });
  } catch {
    blockedWhileLive = true;
  }
  checks.push(["resubmit: 上架卡仍在架时重投同图被拦", blockedWhileLive]);
  await sql`DELETE FROM inspirations WHERE id=${appr3.inspirationId}`;
  const r3b = await submitInspiration(uid, { imageId: img3, title: "T3c", prompt: "P3" }, { copy: copyStub });
  checks.push(["resubmit: 上架卡删除后允许重投同图", r3b.status === "pending"]);

  // ===== 8) 唯一索引兜底并发同图双投（审查 confirmed#1：第二条 pending 必冲突）=====
  const { imageId: img4 } = await mkImage(uid);
  await sql`INSERT INTO inspiration_submissions(user_id, source_image_id, image_key, image_url, title, prompt, status)
            VALUES(${uid}, ${img4}, ${`inspirations/submissions/${uid}/uq-a.png`}, 'https://x/uq-a.png', 'U', 'p', 'pending')`;
  let uniqErr = false;
  try {
    await sql`INSERT INTO inspiration_submissions(user_id, source_image_id, image_key, image_url, title, prompt, status)
              VALUES(${uid}, ${img4}, ${`inspirations/submissions/${uid}/uq-b.png`}, 'https://x/uq-b.png', 'U', 'p', 'pending')`;
  } catch {
    uniqErr = true;
  }
  checks.push(["unique-index: 同图第二条 pending 被唯一索引拒(并发兜底)", uniqErr]);

  // ===== 清理（FK：先删 audit_log/inspirations，再删 users 级联 submissions/notifications）=====
  await sql`DELETE FROM audit_log WHERE admin_id = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM inspirations WHERE submitted_by = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM notifications WHERE user_id = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM inspiration_submissions WHERE user_id = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[inspiration-submissions-smoke] ${pass ? "PASS" : "FAIL"} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[inspiration-submissions-smoke] FAIL:", e);
  process.exit(1);
});
