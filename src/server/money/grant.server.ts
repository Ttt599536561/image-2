// ★server-only：注册原子发放（03 §4.4 / 05 §6.6）。建号即单事务发 0.14。
// 幂等 + 并发安全：以 credit_accounts(user_id PK) 的 INSERT…ON CONFLICT DO NOTHING RETURNING 作串行化闸
// （账户存在 ⟺ 已 onboard）；重入/并发只有一个 run 能继续，杜绝重复 lot/events——比 03 §4.4 字面顺序
// 更严地兑现「重试不重发」意图，uq_grant_signup 仍作账本硬背线。
import { readConfigInt } from "../config.server";
import { type TxClient, tx } from "../tx.server";

async function run(c: TxClient, userId: string, email: string): Promise<void> {
  const grantMp = await readConfigInt(c, "signup_grant_mp", 140);
  const validDays = await readConfigInt(c, "signup_grant_valid_days", 30);

  // FK 前提：业务 users 行必须先存在（id = Better Auth user.id，05 §6.2）。
  await c.query(`INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT (id) DO NOTHING`, [userId, email]);

  // 串行化闸：账户首建即「本 run 赢得 onboard」；已存在 → affected=0 → 幂等空操作返回。
  const acct = await c.query(
    `INSERT INTO credit_accounts(user_id,balance_mp) VALUES($1,$2)
     ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [userId, grantMp > 0 ? grantMp : 0],
  );
  if (acct.rowCount === 0) return; // 已 onboard：不重复发 lot/账本/events

  if (grantMp > 0) {
    // signup 批次（now()+validDays 天到期）。$3::int * interval 避免「$3 || ' days'」的参数类型歧义。
    await c.query(
      `INSERT INTO credit_lots(user_id,source,granted_mp,remaining_mp,expires_at)
       VALUES($1,'signup',$2,$2, now() + ($3::int * interval '1 day'))`,
      [userId, grantMp, validDays],
    );
    // grant 流水（balance_after=grantMp，账户本 run 新建；uq_grant_signup 硬背线）。
    // user_id(uuid) 与 ref_id(text) 用「不同参数」($1 / $3) 传同一 userId，避免单参数跨两型触发 42P08。
    await c.query(
      `INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
       VALUES($1,'grant',$2,$2,'signup',$3) ON CONFLICT DO NOTHING`,
      [userId, grantMp, userId],
    );
    await c.query(
      `INSERT INTO events(type,user_id,payload) VALUES('user_registered',$1,$2),('credit_granted',$1,$3)`,
      [userId, { email }, { amountMp: grantMp, source: "signup" }],
    );
  } else {
    // 站长把赠送额设为 0：仅建号、记注册事件，不发批次/账本。
    await c.query(`INSERT INTO events(type,user_id,payload) VALUES('user_registered',$1,$2)`, [userId, { email }]);
  }
}

/**
 * 注册原子发放。传入已有事务 client c 则在其中跑；否则自起事务。
 * 钩子失败应让注册失败（向上抛），重试安全（闸 + uq_grant_signup 幂等）。
 */
export async function grantSignup(userId: string, email: string, c?: TxClient): Promise<void> {
  if (c) return run(c, userId, email);
  return tx((cc) => run(cc, userId, email));
}
