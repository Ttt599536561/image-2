// ★server-only：入队三闸 + 建会话 + INSERT generations(queued)，全在「同一 Pool/WS 事务」内（真相源 03 §4.9 / 04 §5.2）。
//   并发闸(409) → 余额闸(402，只判不扣) → 软预算闸(429)。任一不过即抛 httpError（事务 ROLLBACK、不入队、不扣费）。
//
// 🔴 红线：余额校验「只判不扣」（成功才扣在 03 §4.3）；INSERT generations 与三闸同一事务、并以
//   `SELECT … FOR UPDATE` 锁住该用户 credit_accounts 行作串行化点，杜绝「并发两次提交都读到余额够/并发未满」的双花/超并发。
import { randomUUID } from "node:crypto";
import { httpError } from "../../contracts/error";
import type { CredentialMode } from "../../contracts/generate";
import { readConfigInt } from "../config.server";
import { isDailyBudgetExhausted } from "../budget.server";
import { type TxClient, tx } from "../tx.server";
import { encryptCustomApiKey, type EncryptedCustomApiKey } from "./credential.server";

export interface EnqueueUser {
  id: string;
  maxConcurrency: number;
}

export interface EnqueueRequest {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  conversationId?: string; // 客户端提供：新建用此 id（owner-safe upsert）/ 续聊传既有 id
  generationId?: string; // 客户端提供：generations 行用此 id（乐观 turn 与服务端同 id）
  inputImageKey?: string | null; // ④b 图生图：参考图 key（owner-scope 在 run() 内校验）
  credentialMode: CredentialMode;
  customApiKey?: string;
}

export interface EnqueueResult {
  generationId: string;
  conversationId: string;
  credentialMode: CredentialMode;
  deadlineAt: string;
}

type PersistableEnqueueRequest = Omit<EnqueueRequest, "customApiKey" | "generationId">;

async function run(
  c: TxClient,
  user: EnqueueUser,
  input: PersistableEnqueueRequest,
  generationId: string,
  encrypted: EncryptedCustomApiKey | null,
): Promise<EnqueueResult> {
  // ④b owner-scope：参考图 key 必须属本人（uploads/<me>/…），杜绝拿别人/伪造 key 进图生图。
  // 入队前就拒（不入队、不调中转），是越权防线；通过则原样落 generations.input_image_key。
  const inputImageKey = input.inputImageKey?.trim() || null;
  if (inputImageKey && !inputImageKey.startsWith(`uploads/${user.id}/`)) {
    throw httpError(400, "INVALID_PARAM", "参考图无效");
  }

  if (input.credentialMode === "system") {
    // system 以账户行为串行化点；custom 不占本站账户并发槽，也不要求余额账户存在。
    const acct = await c.query("SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE", [user.id]);
    if (acct.rowCount === 0) {
      throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
    }

    const inflight = await c.query(
      `SELECT COUNT(*)::int AS n FROM generations
       WHERE user_id=$1 AND credential_mode='system' AND status IN ('queued','claimed','running')`,
      [user.id],
    );
    const current = Number(inflight.rows[0].n);
    if (current >= user.maxConcurrency) {
      throw httpError(409, "CONCURRENCY_LIMIT", "超出并发数量", { limit: user.maxConcurrency, current });
    }

    const priceMp = await readConfigInt(c, "price_per_image_mp", 70);
    const bal = await c.query(
      `SELECT COALESCE(SUM(remaining_mp),0)::bigint AS s FROM credit_lots
       WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`,
      [user.id],
    );
    if (Number(bal.rows[0].s) < priceMp) {
      throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
    }

    if (await isDailyBudgetExhausted(c)) {
      throw httpError(429, "BUDGET_EXHAUSTED", "今日额度已满，请稍后");
    }
  }

  // 通过 → 建会话（如新）+ INSERT generations(queued)。
  let conversationId = input.conversationId;
  if (conversationId) {
    // 客户端提供 id（乐观立即跳转）：既有则复用、不存在则用此 id 新建——单条 owner-safe upsert。
    // ON CONFLICT DO UPDATE 的 WHERE 限本人：他人占用该 id → 不更新、无 RETURNING → 404（防越权挂别人会话）。
    // 既有会话只 bump updated_at、不改 title（续聊不应改名）；新建才落 title。
    const title = input.prompt.slice(0, 20);
    const r = await c.query(
      `INSERT INTO conversations(id, user_id, title) VALUES($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET updated_at=now()
       WHERE conversations.user_id=$2
       RETURNING id`,
      [conversationId, user.id, title],
    );
    if (r.rowCount === 0) throw httpError(404, "NOT_FOUND", "会话不存在");
    conversationId = r.rows[0].id as string;
  } else {
    const title = input.prompt.slice(0, 20);
    const conv = await c.query("INSERT INTO conversations(user_id, title) VALUES($1,$2) RETURNING id", [user.id, title]);
    conversationId = conv.rows[0].id as string;
  }

  const gen = await c.query(
    `INSERT INTO generations(
       id,conversation_id,user_id,prompt,model,size,quality,background,moderation,input_image_key,
       credential_mode,deadline_at,status
     )
     VALUES($1,$2,$3,$4,'gpt-image-2',$5,$6,$7,'low',$8,$9,now()+interval '5 minutes','queued')
     ON CONFLICT(id) DO NOTHING
     RETURNING id,deadline_at`,
    [
      generationId,
      conversationId,
      user.id,
      input.prompt,
      input.size,
      input.quality ?? null,
      input.background ?? null,
      inputImageKey,
      input.credentialMode,
    ],
  );
  if (gen.rowCount === 0) throw httpError(400, "INVALID_PARAM", "任务标识无效");

  if (input.credentialMode === "custom") {
    if (!encrypted) throw httpError(500, "INTERNAL", "自定义 Key 暂时不可用");
    await c.query(
      `INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
       VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [generationId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion],
    );
  }

  return {
    generationId,
    conversationId,
    credentialMode: input.credentialMode,
    deadlineAt: new Date(gen.rows[0].deadline_at as string | Date).toISOString(),
  };
}

/** 入队三闸（同一 Pool/WS 事务 + FOR UPDATE）。抛 httpError(402/409/429/404)；通过返回 {generationId, conversationId}。 */
export async function enqueueGeneration(args: { user: EnqueueUser; input: EnqueueRequest }): Promise<EnqueueResult> {
  const { input } = args;
  if (input.credentialMode !== "system" && input.credentialMode !== "custom") {
    throw httpError(400, "INVALID_PARAM", "参数无效");
  }
  if (input.credentialMode === "custom" && !input.customApiKey?.trim()) {
    throw httpError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key");
  }
  if (input.credentialMode === "system" && input.customApiKey !== undefined) {
    throw httpError(400, "SYSTEM_MODE_FORBIDS_CUSTOM_KEY", "系统 Key 模式不接受自定义 Key");
  }

  const generationId = input.generationId ?? randomUUID();
  const encrypted =
    input.credentialMode === "custom"
      ? encryptCustomApiKey(generationId, (input.customApiKey as string).trim())
      : null;
  const { customApiKey: _customApiKey, generationId: _generationId, ...persistableInput } = input;
  return tx((c) => run(c, args.user, persistableInput, generationId, encrypted));
}
