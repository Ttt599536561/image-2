---
paths:
  - "src/server/money/**"
  - "src/server/generation/**"
  - "src/server/budget.server.ts"
  - "src/server/tx.server.ts"
  - "src/contracts/redeem.ts"
  - "src/contracts/account.ts"
  - "src/contracts/me.ts"
  - "src/contracts/package.ts"
  - "tests/money/**"
---

# 钱链路红线（编辑钱相关代码时必守 — 命门，钱不能错）

> 这是**提醒 + 路由**，不是真相源。权威细节看 [docs/dev/03-money.md](../../docs/dev/03-money.md)（账本/批次/扣费/兑换/调账/对账）+ [04-generation-pipeline.md](../../docs/dev/04-generation-pipeline.md)（管线/抢占）+ 规格 §22。

- 金额一律 **整数毫积分（mp）BIGINT**，绝不浮点；展示才 `/1000`（`src/lib/format.ts` `formatCredits`，反向 `creditsToMp` 用 `Math.round`）。
- **成功才扣**：落存储成功才 `debit`；`generation_id` 幂等键（`uq_debit` 部分唯一索引）防重复扣。
- 扣费走 **⓪双守卫**（锁 generation 行断言 running + 探 debit 幂等），再 **FIFO** 扣批次（`expires_at ASC NULLS LAST, created_at ASC`），扣到 0 不出负（`credit_accounts.balance_mp >= 0` CHECK 兜底）。
- 兑换码 **原子核销**：`UPDATE ... WHERE status='active' RETURNING`（抢不到=已用/无效）。
- **adjust 调积分**：同一事务内同时动 `credit_lots`（增=建 `source='adjust'` 批次 / 减=FIFO 扣**未过期**批 `AND (expires_at IS NULL OR expires_at>now())`）+ 物化余额 + 账本 + 审计；**减额只扣未过期批**（否则被对账 cron 以 SUM(未过期) 反转抵消）；方向编码在 `reason` 前缀（`"+ …"`/`"- …"`）。
- 钱/码事务走 `@neondatabase/serverless` **Pool/WS**（`tx.server.ts`）+ `FOR UPDATE`；看板/列表 SUM 走 **`::text` string codec**（`sumCodec.ts`，防大额精度丢失）。
- 单日预算熔断：硬上限与递增同一原子条件 `UPDATE ... WHERE calls<阈值 RETURNING`（防 TOCTOU 击穿）。
- 改动后必跑 **`npm run test:money`**（真库并发/重入/幂等）；涉读路径补对真 Neon smoke。
