// ★server-only：入队三闸 + 建会话 + INSERT generations(queued)，全在「同一 Pool/WS 事务」内（真相源 03 §4.9 / 04 §5.2）。
//   并发闸(409) → 余额闸(402，只判不扣) → 软预算闸(429)。任一不过即抛 httpError（事务 ROLLBACK、不入队、不扣费）。
//
// 🔴 红线：余额校验「只判不扣」（成功才扣在 03 §4.3）；INSERT generations 与三闸同一事务、并以
//   `SELECT … FOR UPDATE` 锁住该用户 credit_accounts 行作串行化点，杜绝「并发两次提交都读到余额够/并发未满」的双花/超并发。
import { httpError } from "../../contracts/error";
import { readConfigInt } from "../config.server";
import { isDailyBudgetExhausted } from "../budget.server";
import { type TxClient, tx } from "../tx.server";

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
}

export interface EnqueueResult {
  generationId: string;
  conversationId: string;
}

async function run(c: TxClient, user: EnqueueUser, input: EnqueueRequest): Promise<EnqueueResult> {
  // ④b owner-scope：参考图 key 必须属本人（uploads/<me>/…），杜绝拿别人/伪造 key 进图生图。
  // 入队前就拒（不入队、不调中转），是越权防线；通过则原样落 generations.input_image_key。
  const inputImageKey = input.inputImageKey?.trim() || null;
  if (inputImageKey && !inputImageKey.startsWith(`uploads/${user.id}/`)) {
    throw httpError(400, "INVALID_PARAM", "参考图无效");
  }

  // 串行化点：锁该用户账户行。两个并发入队对同一用户在此排队，使下方 COUNT/SUM 读到一致快照。
  const acct = await c.query("SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE", [user.id]);
  if (acct.rowCount === 0) {
    // 未 onboard（理论上注册即建账户）→ 无可用积分，按余额不足拒。
    throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  }

  // 并发闸：进行中数 < max_concurrency（COUNT 为准、无独立计数列）。
  const inflight = await c.query(
    `SELECT COUNT(*)::int AS n FROM generations WHERE user_id=$1 AND status IN ('queued','claimed','running')`,
    [user.id],
  );
  const current = inflight.rows[0].n as number;
  if (current >= user.maxConcurrency) {
    throw httpError(409, "CONCURRENCY_LIMIT", "超出并发数量", { limit: user.maxConcurrency, current });
  }

  // 余额闸（只判不扣）：可用批次之和 ≥ PRICE_MP。
  const priceMp = await readConfigInt(c, "price_per_image_mp", 70);
  const bal = await c.query(
    `SELECT COALESCE(SUM(remaining_mp),0)::bigint AS s FROM credit_lots
     WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`,
    [user.id],
  );
  if (Number(bal.rows[0].s) < priceMp) {
    throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  }

  // 软预算闸（铁律①·省 compute 的第一道闸；硬上限在后台调中转前，见 budget.server）。
  if (await isDailyBudgetExhausted(c)) {
    throw httpError(429, "BUDGET_EXHAUSTED", "今日额度已满，请稍后");
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

  // generations 行：客户端提供 generationId 则用之（乐观 turn 同 id，轮询即时对上）；否则服务端生成。
  const gen = input.generationId
    ? await c.query(
        `INSERT INTO generations(id, conversation_id, user_id, prompt, model, size, quality, background, moderation, input_image_key, status)
         VALUES ($1,$2,$3,$4,'gpt-image-2',$5,$6,$7,'low',$8,'queued') RETURNING id`,
        [input.generationId, conversationId, user.id, input.prompt, input.size, input.quality ?? null, input.background ?? null, inputImageKey],
      )
    : await c.query(
        `INSERT INTO generations(conversation_id, user_id, prompt, model, size, quality, background, moderation, input_image_key, status)
         VALUES ($1,$2,$3,'gpt-image-2',$4,$5,$6,'low',$7,'queued') RETURNING id`,
        [conversationId, user.id, input.prompt, input.size, input.quality ?? null, input.background ?? null, inputImageKey],
      );
  return { generationId: gen.rows[0].id as string, conversationId };
}

/** 入队三闸（同一 Pool/WS 事务 + FOR UPDATE）。抛 httpError(402/409/429/404)；通过返回 {generationId, conversationId}。 */
export async function enqueueGeneration(args: { user: EnqueueUser; input: EnqueueRequest }): Promise<EnqueueResult> {
  return tx((c) => run(c, args.user, args.input));
}
