// 钱链路真库测试公共助手。建测试 user/批次/会话+生成/兑换码，读余额/批次/账本/状态，按依赖序清理。
// 用 getSql()(HTTP) 做 setup/teardown 单语句；被测函数各自走 tx()/getPool()(Pool/WS+FOR UPDATE)。
import { randomUUID } from "node:crypto";
import { getSql } from "../../src/db/db.server";

type Sql = ReturnType<typeof getSql>;

/**
 * 读当前生效单图价（mp）。钱测试断言随后台改价自适应——不写死 70。
 * （测试与生产共用一个 Neon 库；ensureSeedConfig 用 DO NOTHING 不覆盖站长设定的价，故断言必须按实际价算。）
 */
export async function priceMp(sql: Sql): Promise<number> {
  const r = await sql`SELECT value_json FROM app_config WHERE key='price_per_image_mp'`;
  const v = Number(r[0]?.value_json);
  return Number.isFinite(v) ? v : 70;
}

/** 读当前生效注册赠送额（mp）。同 priceMp：随后台配置自适应，不写死 140。 */
export async function signupGrantMp(sql: Sql): Promise<number> {
  const r = await sql`SELECT value_json FROM app_config WHERE key='signup_grant_mp'`;
  const v = Number(r[0]?.value_json);
  return Number.isFinite(v) ? v : 140;
}

/** 幂等确保核心 app_config（与 seed 默认一致；测试不依赖 seed 是否跑过）。 */
export async function ensureSeedConfig(sql: Sql): Promise<void> {
  const defaults: Record<string, number> = {
    price_per_image_mp: 70,
    signup_grant_mp: 140,
    signup_grant_valid_days: 30,
    retention_free_days: 7,
    retention_paid_days: 60,
    default_max_concurrency: 2,
  };
  for (const [k, v] of Object.entries(defaults)) {
    await sql`INSERT INTO app_config(key,value_json) VALUES (${k}, ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO NOTHING`;
  }
}

export interface TestCtx {
  sql: Sql;
  userIds: string[];
  codeIds: string[];
  createUser(opts?: { hasPaid?: boolean; maxConcurrency?: number; balanceMp?: number }): Promise<string>;
  /** 建批次。expiresInDays: number=N天后过期；null=永久；负数=已过期（用于过期 cron 用例）。 */
  addLot(userId: string, remainingMp: number, opts?: { source?: string; expiresInDays?: number | null; codeId?: string | null }): Promise<string>;
  createGeneration(userId: string, opts?: { status?: string; startedAtAgoSec?: number }): Promise<{ conversationId: string; generationId: string }>;
  createCode(opts: { creditsMp: number; cashValue: number; validDays?: number | null; status?: string }): Promise<{ id: string; code: string }>;
  balanceMp(userId: string): Promise<number>;
  lots(userId: string): Promise<Array<{ id: string; source: string; remaining_mp: number; expires_at: string | null }>>;
  ledger(userId: string, entryType?: string): Promise<Array<Record<string, unknown>>>;
  gen(generationId: string): Promise<Record<string, unknown> | undefined>;
  images(generationId: string): Promise<Array<Record<string, unknown>>>;
  events(userId: string, type?: string): Promise<Array<Record<string, unknown>>>;
  cleanup(): Promise<void>;
}

export function newCtx(): TestCtx {
  const sql = getSql();
  const userIds: string[] = [];
  const codeIds: string[] = [];

  return {
    sql,
    userIds,
    codeIds,

    async createUser(opts = {}) {
      const id = randomUUID();
      const email = `mtest+${id.slice(0, 12)}@example.com`;
      await sql`INSERT INTO users(id,email,has_paid,max_concurrency) VALUES (${id}, ${email}, ${opts.hasPaid ?? false}, ${opts.maxConcurrency ?? 2})`;
      await sql`INSERT INTO credit_accounts(user_id,balance_mp) VALUES (${id}, ${opts.balanceMp ?? 0})`;
      userIds.push(id);
      return id;
    },

    async addLot(userId, remainingMp, opts = {}) {
      const id = randomUUID();
      const source = opts.source ?? "code";
      const codeId = opts.codeId ?? null;
      const d = opts.expiresInDays;
      // d===undefined → 默认 30 天后；null → 永久；数字（含负）→ now()+d天。
      if (d === null) {
        await sql`INSERT INTO credit_lots(id,user_id,source,code_id,granted_mp,remaining_mp,expires_at)
                  VALUES (${id}, ${userId}, ${source}, ${codeId}, ${remainingMp}, ${remainingMp}, NULL)`;
      } else {
        const days = d ?? 30;
        await sql`INSERT INTO credit_lots(id,user_id,source,code_id,granted_mp,remaining_mp,expires_at)
                  VALUES (${id}, ${userId}, ${source}, ${codeId}, ${remainingMp}, ${remainingMp}, now() + (${days}::int * interval '1 day'))`;
      }
      return id;
    },

    async createGeneration(userId, opts = {}) {
      const convId = randomUUID();
      const genId = randomUUID();
      await sql`INSERT INTO conversations(id,user_id,title) VALUES (${convId}, ${userId}, 'mtest')`;
      const status = opts.status ?? "queued";
      if (status === "running" || status === "claimed") {
        // running/claimed 写 started_at（可拨早 startedAtAgoSec 秒，用于超时/duration 用例）。
        const ago = opts.startedAtAgoSec ?? 0;
        await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at)
                  VALUES (${genId}, ${convId}, ${userId}, 'mtest prompt', 'auto', ${status}, now() - (${ago}::int * interval '1 second'))`;
      } else {
        await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status)
                  VALUES (${genId}, ${convId}, ${userId}, 'mtest prompt', 'auto', ${status})`;
      }
      return { conversationId: convId, generationId: genId };
    },

    async createCode(opts) {
      const id = randomUUID();
      // 18 位、合法字母表（避免触发 BAD_CODE_FORMAT；测试用确定串）。
      const code = `MTEST${id.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 13)}`.slice(0, 18).padEnd(18, "2");
      await sql`INSERT INTO redeem_codes(id,code,credits_value_mp,cash_value,valid_days,status)
                VALUES (${id}, ${code}, ${opts.creditsMp}, ${opts.cashValue}, ${opts.validDays ?? null}, ${opts.status ?? "active"})`;
      codeIds.push(id);
      return { id, code };
    },

    async balanceMp(userId) {
      const r = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${userId}`;
      return Number(r[0]?.balance_mp ?? 0);
    },
    async lots(userId) {
      return (await sql`SELECT id, source, remaining_mp, expires_at FROM credit_lots WHERE user_id=${userId} ORDER BY created_at`) as Array<{
        id: string;
        source: string;
        remaining_mp: number;
        expires_at: string | null;
      }>;
    },
    async ledger(userId, entryType) {
      if (entryType) {
        return (await sql`SELECT * FROM credit_ledger WHERE user_id=${userId} AND entry_type=${entryType} ORDER BY created_at`) as Array<Record<string, unknown>>;
      }
      return (await sql`SELECT * FROM credit_ledger WHERE user_id=${userId} ORDER BY created_at`) as Array<Record<string, unknown>>;
    },
    async gen(generationId) {
      const r = await sql`SELECT * FROM generations WHERE id=${generationId}`;
      return r[0] as Record<string, unknown> | undefined;
    },
    async images(generationId) {
      return (await sql`SELECT * FROM images WHERE generation_id=${generationId}`) as Array<Record<string, unknown>>;
    },
    async events(userId, type) {
      if (type) {
        return (await sql`SELECT * FROM events WHERE user_id=${userId} AND type=${type} ORDER BY created_at`) as Array<Record<string, unknown>>;
      }
      return (await sql`SELECT * FROM events WHERE user_id=${userId} ORDER BY created_at`) as Array<Record<string, unknown>>;
    },

    async cleanup() {
      // 依赖序：events / audit_log / redeem_codes（FK redeemed_by → users）先删，再删 users（级联 credit_*/conversations→generations→images）。
      if (userIds.length > 0) {
        await sql`DELETE FROM events WHERE user_id = ANY(${userIds}::uuid[])`;
        await sql`DELETE FROM audit_log WHERE admin_id = ANY(${userIds}::uuid[]) OR target_id = ANY(${userIds}::text[])`;
      }
      if (codeIds.length > 0) {
        await sql`DELETE FROM redeem_codes WHERE id = ANY(${codeIds}::uuid[])`;
      }
      if (userIds.length > 0) {
        await sql`DELETE FROM redeem_codes WHERE redeemed_by = ANY(${userIds}::uuid[])`;
        await sql`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
      }
    },
  };
}
