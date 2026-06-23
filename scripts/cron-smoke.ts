// ⑦ cron：对真 Neon 端到端冒烟（直接调 server 函数，免起 Scheduled/HTTP）。覆盖
//   超时重扫 / 积分过期 / 余额对账 / 图片清理(通知预扫+付费顺延+删过期+孤儿) / 旧预算键清理+ms 重算。
// R2 删除/列举注入桩（不烧 Supabase）。跑：node --env-file=.env --import tsx scripts/cron-smoke.ts
//
// ⚠️ 真库副作用：rescanTimeouts/expireCredits/reconcileBalances 全局（非 owner-scoped，cron 本性）——会顺带
//    处理库内其它「确属超时/到期/漂账」的行。仅在自有 dev Neon 上跑；断言只校验本脚本造的行。
import { randomUUID } from "node:crypto";
import { getSql } from "../src/db/db.server";
import { budgetTodayKey, cleanupBudgetKeys, markBudgetAlertedOnce } from "../src/server/budget.server";
import { dispatchStaleQueued, rescanTimeouts } from "../src/server/generation/scan.server";
import {
  cleanExpiredImages,
  deleteExpiredImages,
  prescanExpiringNotifications,
  renewPaidExpired,
  sweepOrphanR2Objects,
} from "../src/server/maintenance.server";
import { expireCredits } from "../src/server/money/expire.server";
import { reconcileBalances } from "../src/server/money/reconcile.server";
import { storageKeyFromPublicUrl } from "../src/server/r2.server";

const sql = getSql();
const checks: [string, boolean][] = [];
const userIds: string[] = [];

async function mkUser(opts: { balanceMp?: number; hasPaid?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO users(id,email,has_paid,max_concurrency) VALUES (${id}, ${`cron+${id.slice(0, 12)}@example.com`}, ${opts.hasPaid ?? false}, 2)`;
  await sql`INSERT INTO credit_accounts(user_id,balance_mp) VALUES (${id}, ${opts.balanceMp ?? 0})`;
  userIds.push(id);
  return id;
}

async function mkLot(userId: string, mp: number, expiresInDays: number | null): Promise<string> {
  const id = randomUUID();
  if (expiresInDays === null) {
    await sql`INSERT INTO credit_lots(id,user_id,source,granted_mp,remaining_mp,expires_at)
              VALUES (${id}, ${userId}, 'code', ${mp}, ${mp}, NULL)`;
  } else {
    await sql`INSERT INTO credit_lots(id,user_id,source,granted_mp,remaining_mp,expires_at)
              VALUES (${id}, ${userId}, 'code', ${mp}, ${mp}, now() + (${expiresInDays}::int * interval '1 day'))`;
  }
  return id;
}

/** 建 conv+gen(succeeded)+image，返回 {imageId, storageKey}。expiresInHours 控制 images.expires_at。 */
async function mkImage(userId: string, expiresInHours: number | null): Promise<{ imageId: string; storageKey: string }> {
  const convId = randomUUID();
  const genId = randomUUID();
  const imageId = randomUUID();
  const storageKey = `${userId}/2026/06/${genId}-smoke.png`;
  await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${userId}, 'cron')`;
  await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at,completed_at)
            VALUES (${genId}, ${convId}, ${userId}, 'p', 'auto', 'succeeded', now(), now())`;
  if (expiresInHours === null) {
    await sql`INSERT INTO images(id,generation_id,user_id,storage_key,public_url,expires_at)
              VALUES (${imageId}, ${genId}, ${userId}, ${storageKey}, ${`https://x/${storageKey}`}, NULL)`;
  } else {
    await sql`INSERT INTO images(id,generation_id,user_id,storage_key,public_url,expires_at)
              VALUES (${imageId}, ${genId}, ${userId}, ${storageKey}, ${`https://x/${storageKey}`}, now() + (${expiresInHours}::int * interval '1 hour'))`;
  }
  return { imageId, storageKey };
}

async function main(): Promise<void> {
  // ===== 1) 超时重扫 =====
  {
    const uid = await mkUser({ balanceMp: 140 });
    await mkLot(uid, 140, 30);
    const convId = randomUUID();
    const staleId = randomUUID();
    const freshId = randomUUID();
    await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${uid}, 'cron')`;
    await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at,updated_at)
              VALUES (${staleId}, ${convId}, ${uid}, 'p', 'auto', 'running', now()-interval '6 minutes', now()-interval '6 minutes')`;
    await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at)
              VALUES (${freshId}, ${convId}, ${uid}, 'p', 'auto', 'running', now())`;

    await rescanTimeouts();
    const [stale] = await sql`SELECT status, error_code, duration_ms FROM generations WHERE id=${staleId}`;
    const [fresh] = await sql`SELECT status FROM generations WHERE id=${freshId}`;
    const ev = await sql`SELECT 1 FROM events WHERE user_id=${uid} AND type='image_failed'`;
    const bal = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${uid}`;
    const deb = await sql`SELECT 1 FROM credit_ledger WHERE user_id=${uid} AND entry_type='debit'`;
    checks.push(["超时重扫: 6min running → failed/provider_timeout", stale?.status === "failed" && stale?.error_code === "provider_timeout"]);
    checks.push(["超时重扫: duration_ms≈360000 不被 MILLISECONDS 截断(>300000)", Number(stale?.duration_ms) > 300_000]);
    checks.push(["超时重扫: 新鲜 running 不动", fresh?.status === "running"]);
    checks.push(["超时重扫: 写 image_failed 事件", ev.length === 1]);
    checks.push(["超时重扫: 未扣费、余额不变(140)", deb.length === 0 && Number(bal[0]?.balance_mp) === 140]);
  }

  // ===== 2) 积分过期（FIFO 清零 + 幂等）=====
  {
    const uid = await mkUser({ balanceMp: 100 });
    const expiredLot = await mkLot(uid, 100, -1); // 1 天前已过期
    await expireCredits();
    const [lot] = await sql`SELECT remaining_mp FROM credit_lots WHERE id=${expiredLot}`;
    const [bal] = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${uid}`;
    const exp = await sql`SELECT amount_mp FROM credit_ledger WHERE user_id=${uid} AND entry_type='expire'`;
    checks.push(["过期: 到期批次清零(remaining=0)", Number(lot?.remaining_mp) === 0]);
    checks.push(["过期: 物化余额同步减到 0", Number(bal?.balance_mp) === 0]);
    checks.push(["过期: 写 expire 流水 1 笔(100mp)", exp.length === 1 && Number(exp[0].amount_mp) === 100]);
    // 重跑幂等：uq_expire_lot 命中，不重复减、不重复记。
    await expireCredits();
    const exp2 = await sql`SELECT 1 FROM credit_ledger WHERE user_id=${uid} AND entry_type='expire'`;
    const [bal2] = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${uid}`;
    checks.push(["过期: 重跑幂等(expire 仍 1 笔、余额仍 0)", exp2.length === 1 && Number(bal2?.balance_mp) === 0]);
  }

  // ===== 3) 余额对账（制造 drift → 检出 + 以批次修正）=====
  {
    const uid = await mkUser({ balanceMp: 999 }); // 物化余额故意错
    await mkLot(uid, 200, 30); // 权威 = 200（未过期）
    const r = await reconcileBalances();
    const mine = r.drifts.find((d) => d.userId === uid);
    const [bal] = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${uid}`;
    const ev = await sql`SELECT 1 FROM events WHERE user_id=${uid} AND type='balance_reconciled'`;
    checks.push(["对账: 检出本用户 drift(auth=200/balance=999)", mine?.authMp === "200" && mine?.balanceMp === "999"]);
    checks.push(["对账: 以批次修正到 200", Number(bal?.balance_mp) === 200]);
    checks.push(["对账: 写 balance_reconciled 事件", ev.length === 1]);
  }

  // ===== 4) 图片清理：通知预扫（dedupe 幂等）=====
  {
    const uid = await mkUser();
    const { imageId } = await mkImage(uid, 12); // 12h 后到期 → 落在「到期前 1 天」窗口
    await prescanExpiringNotifications();
    const n1 = await sql`SELECT id, dedupe_key FROM notifications WHERE user_id=${uid} AND type='image_expiring'`;
    checks.push(["清图⓪通知预扫: 写 1 条 image_expiring + dedupe_key", n1.length === 1 && n1[0].dedupe_key === `image_expiring:${imageId}`]);
    await prescanExpiringNotifications(); // 重跑
    const n2 = await sql`SELECT 1 FROM notifications WHERE user_id=${uid} AND type='image_expiring'`;
    checks.push(["清图⓪通知预扫: 重跑 ON CONFLICT 不重发(仍 1 条)", n2.length === 1]);
  }

  // ===== 5) 图片清理：付费顺延兜底 =====
  {
    const uid = await mkUser({ hasPaid: true });
    const { imageId } = await mkImage(uid, -1); // 已到期 1h（-1h）
    const renewed = await renewPaidExpired();
    const [img] = await sql`SELECT expires_at FROM images WHERE id=${imageId}`;
    const days = (new Date(img.expires_at as string).getTime() - Date.now()) / 86_400_000;
    checks.push(["清图①付费顺延: 付费用户已到期图 → 顺延 ~60 天", renewed >= 1 && days > 58 && days < 61]);
  }

  // ===== 6) 图片清理：删过期图（注入 deleteMany 桩，全成功 / 部分失败）=====
  {
    const uid = await mkUser();
    const a = await mkImage(uid, -2); // 已过期
    const b = await mkImage(uid, -2);
    // 模拟此前已为 a、b 写过 image_expiring 到期提醒（prescan 只对未过期图写，这里直插模拟历史提醒）。
    await sql`INSERT INTO notifications(user_id, type, payload, dedupe_key) VALUES
      (${uid}, 'image_expiring', '{}'::jsonb, ${`image_expiring:${a.imageId}`}),
      (${uid}, 'image_expiring', '{}'::jsonb, ${`image_expiring:${b.imageId}`})`;
    const calledKeys: string[] = [];
    // 桩：a 成功、b 失败（返回未删成功的 key = b）。
    const stub = async (keys: string[]): Promise<string[]> => {
      calledKeys.push(...keys);
      return keys.filter((k) => k === b.storageKey);
    };
    const res = await deleteExpiredImages({ deleteMany: stub });
    const aRow = await sql`SELECT 1 FROM images WHERE id=${a.imageId}`;
    const bRow = await sql`SELECT 1 FROM images WHERE id=${b.imageId}`;
    const cleaned = await sql`SELECT 1 FROM events WHERE user_id=${uid} AND type='image_cleaned'`;
    // ②（2026-06-22）：删图连带删该图 image_expiring 提醒（a 删成功→提醒消；b 删 R2 失败→行与提醒都保留）。
    const naRow = await sql`SELECT 1 FROM notifications WHERE dedupe_key=${`image_expiring:${a.imageId}`}`;
    const nbRow = await sql`SELECT 1 FROM notifications WHERE dedupe_key=${`image_expiring:${b.imageId}`}`;
    checks.push(["清图②删过期: R2 收到两 key", calledKeys.includes(a.storageKey) && calledKeys.includes(b.storageKey)]);
    checks.push(["清图②删过期: 成功的 a 行删除", aRow.length === 0]);
    checks.push(["清图②删过期: 失败的 b 行保留(下轮重扫)", bRow.length === 1]);
    checks.push(["清图②删过期: a 写 image_cleaned 事件 + failedKeys=1", cleaned.length === 1 && res.failedKeys === 1 && res.deleted === 1]);
    checks.push(["清图②删过期: a 的到期提醒连带删除", naRow.length === 0]);
    checks.push(["清图②删过期: b(删R2失败)的到期提醒保留", nbRow.length === 1]);
  }

  // ===== 7) 图片清理：孤儿扫除（注入 listObjects + deleteMany 桩）=====
  {
    const uid = await mkUser();
    const known = await mkImage(uid, 240); // DB 有此 key（10 天后到期，不会被删）
    const orphanKey = `${uid}/2026/06/${randomUUID()}-orphan.png`;
    const oldMs = Date.now() - 7200_000; // 2h 前（过 1h 保护窗口）
    const freshMs = Date.now(); // 刚 PUT、在保护窗口内 → 不删
    const freshOrphan = `${uid}/2026/06/${randomUUID()}-fresh.png`;
    const deleted: string[] = [];
    const res = await sweepOrphanR2Objects({
      listObjects: async () => [
        { key: known.storageKey, lastModified: oldMs },
        { key: orphanKey, lastModified: oldMs },
        { key: freshOrphan, lastModified: freshMs },
      ],
      deleteMany: async (keys) => {
        deleted.push(...keys);
        return [];
      },
    });
    checks.push(["清图③孤儿: 仅删孤儿(DB 无 + 过保护窗口)", deleted.length === 1 && deleted[0] === orphanKey]);
    checks.push(["清图③孤儿: 已知图不删 + 在途(<1h)不删", !deleted.includes(known.storageKey) && !deleted.includes(freshOrphan) && res.orphansDeleted === 1]);
  }

  // ===== 7b) ④b 参考图上传清理：在途(未终态)受保护、已终态/废弃按孤儿回收（用后即弃）=====
  {
    const uid = await mkUser();
    const convId = randomUUID();
    await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId},${uid},'i2i')`;
    const inflightKey = `uploads/${uid}/2026/06/${randomUUID()}-inflight.png`;
    const doneKey = `uploads/${uid}/2026/06/${randomUUID()}-done.png`;
    const abandonedKey = `uploads/${uid}/2026/06/${randomUUID()}-abandoned.png`;
    await sql`INSERT INTO generations(conversation_id,user_id,prompt,size,status,input_image_key) VALUES
      (${convId},${uid},'p','auto','queued',${inflightKey}),
      (${convId},${uid},'p','auto','succeeded',${doneKey})`;
    const oldMs = Date.now() - 7200_000; // 都过 1h 保护窗口
    const deleted: string[] = [];
    await sweepOrphanR2Objects({
      listObjects: async () => [
        { key: inflightKey, lastModified: oldMs },
        { key: doneKey, lastModified: oldMs },
        { key: abandonedKey, lastModified: oldMs },
      ],
      deleteMany: async (keys) => {
        deleted.push(...keys);
        return [];
      },
    });
    checks.push(["④b 上传清理: 在途(queued)参考图受保护不删", !deleted.includes(inflightKey)]);
    checks.push(["④b 上传清理: 已终态(succeeded)参考图按孤儿回收", deleted.includes(doneKey)]);
    checks.push(["④b 上传清理: 废弃(无生成)上传按孤儿回收", deleted.includes(abandonedKey)]);
  }

  // ===== 7c) 灵感封面清理：在用封面(cover_key)受保护、admin 上传后废弃的封面按孤儿回收 =====
  {
    const inUseCover = `inspirations/2026/06/${randomUUID()}.png`;
    const abandonedCover = `inspirations/2026/06/${randomUUID()}.png`;
    const inspId = randomUUID();
    await sql`INSERT INTO inspirations(id,title,cover_url,cover_key,prompt)
      VALUES (${inspId}, 'cover-smoke', ${`https://img.test/${inUseCover}`}, ${inUseCover}, 'p')`;
    const oldMs = Date.now() - 7200_000; // 都过 1h 保护窗口
    const deleted: string[] = [];
    await sweepOrphanR2Objects({
      listObjects: async () => [
        { key: inUseCover, lastModified: oldMs },
        { key: abandonedCover, lastModified: oldMs },
      ],
      deleteMany: async (keys) => {
        deleted.push(...keys);
        return [];
      },
    });
    checks.push(["灵感封面: 在用封面(cover_key)受保护、绝不误删", !deleted.includes(inUseCover)]);
    checks.push(["灵感封面: 废弃上传封面按孤儿回收", deleted.includes(abandonedCover)]);
    await sql`DELETE FROM inspirations WHERE id=${inspId}`; // 清理测试行

    // 派生剥 query/fragment（对抗审查 confirmed）：admin 粘贴带 ?v=1/#a 的本桶 URL 时，
    // 派生 cover_key 必须等于真实 S3 key（不含 ?#），否则孤儿 known-set 比对落空 → 误删在用封面。
    const base = (process.env.STORAGE_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    if (base) {
      const cleanKey = `inspirations/2026/06/${randomUUID()}.png`;
      checks.push(["派生剥 query: 带 ?v=1 → 干净 key", storageKeyFromPublicUrl(`${base}/${cleanKey}?v=1`) === cleanKey]);
      checks.push(["派生剥 fragment: 带 #a → 干净 key", storageKeyFromPublicUrl(`${base}/${cleanKey}#a`) === cleanKey]);
      checks.push(["派生: 外链 → null", storageKeyFromPublicUrl(`https://evil.test/${cleanKey}`) === null]);
    }
  }

  // ===== 7d) 灵感投稿清理：pending 副本受保护、rejected 副本按孤儿回收（§13.1）=====
  {
    const uid = await mkUser();
    const pendingKey = `inspirations/submissions/${uid}/2026/06/${randomUUID()}.png`;
    const rejectedKey = `inspirations/submissions/${uid}/2026/06/${randomUUID()}.png`;
    await sql`INSERT INTO inspiration_submissions(user_id, image_key, image_url, title, prompt, status) VALUES
      (${uid}, ${pendingKey}, ${`https://x/${pendingKey}`}, 'pend', 'p', 'pending'),
      (${uid}, ${rejectedKey}, ${`https://x/${rejectedKey}`}, 'rej', 'p', 'rejected')`;
    const oldMs = Date.now() - 7200_000; // 都过 1h 保护窗口
    const deleted: string[] = [];
    await sweepOrphanR2Objects({
      listObjects: async () => [
        { key: pendingKey, lastModified: oldMs },
        { key: rejectedKey, lastModified: oldMs },
      ],
      deleteMany: async (keys) => {
        deleted.push(...keys);
        return [];
      },
    });
    checks.push(["灵感投稿: 待审(pending)副本受保护、绝不误删", !deleted.includes(pendingKey)]);
    checks.push(["灵感投稿: 已驳回(rejected)副本按孤儿回收", deleted.includes(rejectedKey)]);
    await sql`DELETE FROM inspiration_submissions WHERE user_id=${uid}`;
  }

  // ===== 8) 旧预算键清理 + 昨日 ms 重算（评估「已结束的前一天」）=====
  {
    const oldKey = "relay_budget:2000-01-01";
    await sql`INSERT INTO app_config(key,value_json) VALUES (${oldKey}, '{"calls":5,"ms":5000}'::jsonb) ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json`;
    // 造昨日 key（calls 接近 cap）验回溯熔断告警判定：cap 默认 2000，置 calls=2000 应 budgetExhausted。
    const [{ d: yday }] = (await sql`SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day','YYYY-MM-DD') AS d`) as Array<{ d: string }>;
    const yKey = `relay_budget:${yday}`;
    await sql`INSERT INTO app_config(key,value_json) VALUES (${yKey}, '{"calls":999999,"ms":0}'::jsonb) ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json`;
    const r = await cleanupBudgetKeys();
    const old = await sql`SELECT 1 FROM app_config WHERE key=${oldKey}`;
    checks.push(["预算清理: 删 2000 旧键", old.length === 0 && r.deletedKeys >= 1]);
    checks.push(["预算清理: 评估昨日(evaluatedDate=yday) + ms 重算(number)", r.evaluatedDate === yday && typeof r.recomputedMs === "number"]);
    checks.push(["预算清理: 昨日 calls 超 cap → budgetExhausted(回溯告警)", r.calls === 999999 && r.budgetExhausted === true]);
    await sql`DELETE FROM app_config WHERE key=${yKey}`;
  }

  // ===== 8b) 「命中即告警·每天首次」去重闸 markBudgetAlertedOnce =====
  {
    const key = budgetTodayKey();
    await sql`INSERT INTO app_config(key,value_json) VALUES (${key}, '{"calls":0,"ms":0}'::jsonb) ON CONFLICT (key) DO NOTHING`;
    // 清掉可能的旧 alerted（本测试隔离）。
    await sql`UPDATE app_config SET value_json = value_json - 'alerted' WHERE key=${key}`;
    const first = await markBudgetAlertedOnce();
    const second = await markBudgetAlertedOnce();
    checks.push(["命中即告警去重: 首次 true、再次 false(每天首次)", first === true && second === false]);
    await sql`UPDATE app_config SET value_json = value_json - 'alerted' WHERE key=${key}`; // 还原，不影响真实当日计数
  }

  // ===== 9) cleanExpiredImages 编排（端到端，全桩）=====
  {
    const uid = await mkUser();
    await mkImage(uid, -3); // 过期图
    await mkImage(uid, 12); // 到期前 1 天 → 通知
    const out = await cleanExpiredImages({
      deleteMany: async () => [],
      listObjects: async () => [],
    });
    checks.push(["编排 cleanExpiredImages: 返回 notified/deletedImages 字段", out.notified >= 1 && out.deletedImages >= 1 && out.orphanError === false]);
  }

  // ===== 10) dispatchStaleQueued（无 URL env 时不抛、返回扫到的 id）=====
  {
    const uid = await mkUser();
    const convId = randomUUID();
    const qid = randomUUID();
    await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${uid}, 'cron')`;
    await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,updated_at)
              VALUES (${qid}, ${convId}, ${uid}, 'p', 'auto', 'queued', now()-interval '2 minutes')`;
    const ids = await dispatchStaleQueued();
    checks.push(["派发兜底: 扫到 1–5min 的孤儿 queued(含本行)", ids.includes(qid)]);
  }

  // ===== 清理 =====
  await sql`DELETE FROM events WHERE user_id = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM notifications WHERE user_id = ANY(${userIds}::uuid[])`;
  await sql`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`; // 级联 accounts/lots/ledger/conv→gen→images
  await sql`DELETE FROM app_config WHERE key='relay_budget:2000-01-01'`;

  const pass = checks.every(([, ok]) => ok);
  console.log("\n--- checks ---");
  for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`\n[cron-smoke] ${pass ? "PASS" : "FAIL"} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[cron-smoke] FAIL:", e);
  process.exit(1);
});
