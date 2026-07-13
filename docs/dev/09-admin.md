# 10 · 后台管理

状态：本文后台能力均已在 `0.2.0` 实现。腾讯云生产环境运行提交 `c5131aa`，系统更新入口为 `/admin/system-update`。

> 独立 `/admin/*` 后台（仅 `role=admin`）：兑换码 / 用户 / 灵感库 / 生成记录 / 套餐与全局参数 / 数据看板，外加贯穿全部模块的**敏感操作二次确认 + 审计留痕**。
> 规则真相源：规格 [§9](../redesign-requirements.md)（后台全功能）/ [§16](../redesign-requirements.md)（表）/ [§24-3·§24-13](../redesign-requirements.md)；结构看 [wireframes.html](../prototypes/wireframes.html) 11–18，视觉令牌贴 [design-system.html](../prototypes/design-system.html)，**后台自建、不引 Refine**（[00 §1.1](00-overview.md) 已排除）。
> 鉴权见 [05-auth.md §6.7](05-auth.md)；钱/码核销逻辑本身在 [03-money.md](03-money.md)，本章只写后台调用与对账侧。

---

## 10.1 总览与 RBAC

后台导航包含 `/admin/system-update`。该页显示镜像内固化的版本/提交、宿主机更新状态和官方 GitHub 最新稳定版；只有 `enabled + available + idle` 才能点击“立即更新”。请求接受后浏览器每 2 秒轮询，并把请求 ID 保存在 `sessionStorage`，所以 Web 重启或页面刷新不会丢失跟踪。断线只表示正在重启，不推断失败；页面同时展示宿主机 `status` 命令。

检查更新与启动更新均由 `/api/admin/system-update*` 再次执行 admin 鉴权和严格同源 JSON POST 校验。启动前先写 `system_update_start` 审计，再原子发布唯一请求。Web 不执行 Git、Docker 或 shell，也不接触项目根目录。

2026-07-13 的生产引导已经安装并启用宿主机更新器：`.path` 为 enabled/active，service 为 enabled；页面显示的当前版本为 `0.2.0`。GitHub `v0.2.0` stable/latest Release 尚未发布，因此首次正式一键更新要从后续严格递增的稳定版开始。

**单角色（本期）**：`users.role ∈ {user, admin}`（[02 §3.2](02-database.md) 已建）。RBAC 多级分层（超管/审核员/客服）后置 [§23](../redesign-requirements.md)，但 `role` 字段已在，将来加级不改表。

### 路由与守卫

- 独立路由组 `/admin/*`，与前台用户路由隔离（[08-frontend.md §9.2](08-frontend.md) 的路由表）。
- 守卫两道，**缺一不可**：
  1. RR8 `admin` 布局 loader：每请求 `requireAdmin(request)` —— 取会话 → **每请求查 DB**（不吃 cookieCache）→ `role==='admin' && !is_banned`，否则 `throw redirect('/')`（不暴露后台存在）。详见 [05-auth.md §6.7](05-auth.md)。
  2. 所有 admin API 也独立做同一校验（不依赖前端隐藏菜单）。

### admin API 统一约定

| 项 | 约定 |
|---|---|
| 前缀 | 全部挂 `/api/admin/*`（RR resource routes + server service modules） |
| 鉴权 | 每个 handler 首行 `const admin = await requireAdmin(req)`；非 admin → `403` |
| 钱/码事务 | 走 transaction pool + `FOR UPDATE`（[运行时与配置](00-overview.md)）；看板只读走 `getSql()` |
| 契约 | 请求/响应 Zod schema 放 `src/contracts/admin.ts`（[07-api.md §8.5](07-api.md)） |
| 审计 | 敏感写操作**必须**在同事务内写 `audit_log`（§10.6） |
| 错误码 | 复用 [07-api.md §8.2](07-api.md) 语义（402/409/410/429/403） |

> 列表型端点统一支持 `?page=&pageSize=&q=&from=&to=`，返回 `{ rows, total, page, pageSize }`。

---

## 10.2 兑换码管理

对应 wireframes 18（生成弹窗）。核销事务在 [03-money.md §4.7](03-money.md)；本节只管**批量生成 / 导出 / 查单 / 作废 / 对账**。

### 码格式（§24-4）

18 位 **base32 去易混字符**（去 `0 O 1 I l`），无分隔，全大写：

```ts
// 字母表单一真相源在 src/contracts（[07-api.md §8.5](07-api.md) 据它派生兑换码正则）：
// REDEEM_ALPHABET = 26 字母去 I/O/L (=23) + 2-9 (=8) → 共 31 个字符
import { REDEEM_ALPHABET } from '../../src/contracts'; // = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'，31 字符，可枚举性极低（31^18 ≈ 7e26）
import { randomInt } from 'node:crypto';               // CSPRNG，禁用 Math.random
function genCode(): string {
  let s = ''; for (let i = 0; i < 18; i++) s += REDEEM_ALPHABET[randomInt(REDEEM_ALPHABET.length)];
  return s;
}
```

### 批量生成（POST `/api/admin/codes/generate`）

请求 `{ packageId, count }`（面额/积分/有效期由套餐快照决定，不另填）。一个批次一个 `batch_id`：

```ts
// 1) 读套餐取快照（防套餐后续改动影响已发码 → 快照进 redeem_codes 各列）
const pkg = await getPackage(packageId);          // title, price_cash, credits_mp, valid_days
const batchId = crypto.randomUUID();
// 2) 生成 count 个唯一码（撞 code UNIQUE 即重试该格；批量 INSERT，单事务）
const rows = Array.from({ length: count }, () => ({
  code: genCode(), packageId, batchId,
  creditsValueMp: pkg.credits_mp,   // 快照
  cashValue: pkg.price_cash,        // 面值现金（分），收入按它记账
  validDays: pkg.valid_days,        // 快照；NULL=永久
  status: 'active',
}));
// 3) INSERT … ON CONFLICT(code) DO NOTHING；rowCount<count 则补生成缺口直至齐
// 4) 写 audit_log(action='gen_codes', target_type='package', after={batchId,count,packageId})
// 5) 返回 { batchId, count, codes: string[] }——把本批明文码一并回前端供「一键复制」（commit ac1c310）
```

唯一性靠 `redeem_codes.code UNIQUE`（[02 §3.2](02-database.md)）；`count` 上限做软限（如 ≤ 5000）防超大事务。

> **一键复制（站长诉求·不强制下 CSV，commit `ac1c310`）**：`generateCodes` 响应携 `codes[]`（本批明文码）。撰写区生成后即出**「复制全部(N 个)」按钮 + 只读 `<textarea>`**（一行一码、可框选手动复制，写 `clipboard` 失败时兜底）；明文只在生成那一刻随响应回前端，不另开按码反查明文的端点（查单码 §10.2 末仍只返状态/账目，不回明文）。

### CSV 导出（GET `/api/admin/codes/export?batchId=`）

**保留**（站长可直接复制、也可下 CSV 二选一）：批次列表每行的「复制码」即拉该批 `export` CSV、取**首列 `code`** 拼成纯码文本复制到剪贴板（commit `ac1c310`）；下载 CSV 仍供店铺批量导入。给店铺导入用，逐行 `code,面额(元),积分,有效期`，金额展示层换算（`cash_value/100`、`credits_value_mp/1000`）：

```ts
// Content-Type: text/csv; charset=utf-8；BOM 前缀防 Excel 中文乱码
const header = 'code,price_yuan,credits,valid_days\n';
const body = codes.map(c =>
  `${c.code},${(c.cash_value/100).toFixed(2)},${c.credits_value_mp/1000},${c.valid_days ?? '永久'}`
).join('\n');
// 文件名 codes_<batchId>_YYYYMMDD.csv
```

### 查单码状态（GET `/api/admin/codes/:code`）

返回 `status / package / cash_value / redeemed_by(邮箱) / redeemed_at / batch_id`。`status` 三态：`active|redeemed|disabled`。

### 作废批次（POST `/api/admin/codes/disable-batch`）

只作废**未用**的码（已兑换的保留账目不动）：

```sql
UPDATE redeem_codes SET status='disabled'
WHERE batch_id = $1 AND status='active'
RETURNING id;
-- 返回受影响数；写 audit_log(action='disable_batch', target_id=batchId, after={disabledCount})
```

被作废码后续兑换走 [07-api.md §8.4](07-api.md) 的 `410 兑换码已失效`。

### 批次对账（GET `/api/admin/codes/batch/:batchId`）

发出 / 已用 / 未用 / 已作废 / 金额，通过 `getSql()` 单查询聚合：

```sql
SELECT
  count(*)                                                   AS issued,
  count(*) FILTER (WHERE status='redeemed')                  AS used,
  count(*) FILTER (WHERE status='active')                    AS unused,
  count(*) FILTER (WHERE status='disabled')                  AS disabled,
  -- 金额按面值现金（分）；SUM 走 string codec 见 §11.4
  sum(cash_value) FILTER (WHERE status='redeemed')::text     AS revenue_cash,
  sum(cash_value)::text                                      AS issued_cash
FROM redeem_codes WHERE batch_id = $1;
```

> 收入只认**已兑换**的 `cash_value`（面值现金记账，[03 §4.7](03-money.md) step6）；未用码不计收入。

---

## 10.3 用户管理

对应 wireframes 16（用户详情）。会话吊销在 [05-auth.md §6.5](05-auth.md)；调积分流水在 [03-money.md](03-money.md) 的 `adjust` 语义。

### 搜索（GET `/api/admin/users?q=邮箱`）

`q` 按邮箱前缀/包含匹配（`email ILIKE '%'||$q||'%'`），分页默认 50/页，返回每行：`email / balance_mp / max_concurrency / is_banned / has_paid / created_at`。

### 用户详情（GET `/api/admin/users/:id`）

聚合多源（一次 loader 并发查）：

```sql
-- 余额（物化，快）
SELECT balance_mp FROM credit_accounts WHERE user_id=$1;
-- 批次（FIFO 视图：未过期 remaining + 过期时间）
SELECT source, granted_mp, remaining_mp, expires_at FROM credit_lots WHERE user_id=$1 ORDER BY created_at DESC;
-- 流水（分页）
SELECT entry_type, amount_mp, balance_after_mp, reason, ref_type, ref_id, created_at
  FROM credit_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50;
-- 会话数 / 图片数 / 进行中任务（账户并发只认 system）
SELECT count(*) FROM conversations WHERE user_id=$1;
SELECT count(*) FROM images        WHERE user_id=$1;
SELECT credential_mode, count(*) FROM generations
 WHERE user_id=$1 AND status IN('queued','claimed','running') GROUP BY credential_mode;
-- 注册/活跃：created_at + 最近一次 generation/会话 updated_at
```

### 行尾「⋯」下拉操作（§9 / wireframes 16）

操作收进**行尾「⋯」下拉**，不平铺成链接条：

| 操作 | 端点 | 实现要点 | 审计 action |
|---|---|---|---|
| 封禁 / 解封 | `POST /api/admin/users/:id/ban` `{banned}` | `UPDATE users SET is_banned=$ `；封禁同时**吊销其全部会话**（[05 §6.5](05-auth.md)） | `ban` / `unban` |
| 改密 | `POST /api/admin/users/:id/reset-pw` `{newPassword}` | 走 Better Auth 设密码（**限长防 bcrypt 72 字节截断**，[05 §6.4](05-auth.md)）；**吊销全部会话**强制重登 | `reset_pw`（**不记明文**，`after` 只标 `{changed:true}`） |
| 增减积分 | `POST /api/admin/users/:id/adjust-credit` | 走 `adjust` 流水、**必填原因**、金额 mp、**不出负**（见下） | `adjust_credit` |
| 增减并发 | `POST /api/admin/users/:id/concurrency` `{maxConcurrency}` | `UPDATE users SET max_concurrency=$ CHECK ≥1` | `set_concurrency` |
| 看详情 | （前端跳详情页） | — | — |

### 调积分弹窗（adjust 事务 · 不出负）

`adjust` 是手动增减，**正负都用正数 `amount_mp` + 方向标记**（[03 §4.1](03-money.md) 账本约定：`amount_mp>0`，方向由业务区分）。增 → 建一笔 `source='adjust'` 批次（到期由弹窗设：可永久或 N 天）；减 → 从可用批次 FIFO 扣，**扣不出负**：

```ts
// POST /api/admin/users/:id/adjust-credit  { delta_mp: number(可负,≠0), reason: string(必填), validDays?: number|null(增额到期, NULL=永久) }
await tx(async (c) => {
  // 调整前先取真值 before（同事务内 FOR UPDATE 锁账户行，避免变量未定义/读到旧值）
  const before = (await c.query(`SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE`, [uid])).rows[0].balance_mp;
  let moved;                                     // 本次真正移动的毫积分（正数）；账本/事件/审计一律用它，杜绝"记的≠动的"
  if (delta_mp > 0) {
    // 增：建 source='adjust' 批次（code_id=NULL；expires_at 由弹窗 validDays 定，NULL=永久）——同步动 lots 与物化余额
    // 'adjust' 已在 lot_source CHECK 内（[02 §3.2](02-database.md)），与下方 events {source:'adjust'} 一致
    await c.query(`INSERT INTO credit_lots(user_id,source,code_id,granted_mp,remaining_mp,expires_at)
                   VALUES($1,'adjust',NULL,$2,$2, CASE WHEN $3::int IS NULL THEN NULL ELSE now()+($3||' days')::interval END)`,
                  [uid, delta_mp, validDays ?? null]); // ref 走 ledger
    await c.query(`UPDATE credit_accounts SET balance_mp=balance_mp+$1, updated_at=now() WHERE user_id=$2`, [delta_mp, uid]);
    moved = delta_mp;
  } else {
    // 减：FIFO 锁「可用（未过期）」批次扣 |delta|，扣到 0 为止不出负（余额不足则只扣到 0、并在 reason 标注）——同步动 lots 与物化余额
    // 🔴 必须带 `AND (expires_at IS NULL OR expires_at>now())`，与 debit（03 §4.3）/对账权威 SUM（10 §11.3）/余额闸（03 §4.9）口径一致；
    //    否则减额可能落在「过期 cron 尚未清零」的批次上、被对账以 SUM(未过期) 为准反转抵消（下方红线）。
    const want = -delta_mp;
    const lots = await c.query(`SELECT id,remaining_mp FROM credit_lots
       WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())
       ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE`, [uid]);
    let need = want;
    for (const lot of lots.rows) { if (need<=0) break;
      const take = Math.min(lot.remaining_mp, need);
      await c.query(`UPDATE credit_lots SET remaining_mp=remaining_mp-$1 WHERE id=$2`, [take, lot.id]); need -= take; }
    moved = want - need;                          // 真正扣到的（≤ 请求量，绝不出负；不足时 < 请求量）
    await c.query(`UPDATE credit_accounts SET balance_mp=balance_mp-$1, updated_at=now() WHERE user_id=$2`, [moved, uid]);
  }
  // adjust 流水：amount_mp = 真正移动量 moved（始终正，不写请求量）；方向落进 reason 前缀；balance_after 用 RETURNING 真值
  const dir = delta_mp > 0 ? '+' : '-';
  const after = (await c.query(`INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,reason,ref_type,ref_id)
     VALUES($1,'adjust',$2,(SELECT balance_mp FROM credit_accounts WHERE user_id=$1),$3,'admin',$4)
     RETURNING balance_after_mp`,
     [uid, moved, `${dir} ${reason}`, admin.id])).rows[0].balance_after_mp;
  // 审计（before/after 余额均为同事务内真值，与 §10.6 红线一致）
  await writeAudit(c, { adminId: admin.id, action:'adjust_credit', targetType:'user', targetId:uid,
    before:{balance_mp:before}, after:{balance_mp:after}, reason, ip });
  // 事实事件：增→credit_granted、减→credit_consumed（按方向区分，避免污染看板"发放 vs 消耗"口径），均带 source:'adjust' 与真实 moved
  const evType = delta_mp > 0 ? 'credit_granted' : 'credit_consumed';
  await c.query(`INSERT INTO events(type,user_id,payload) VALUES($1,$2,$3)`, [evType, uid, {source:'adjust', amountMp:moved, direction:dir}]);
});
```

> `credit_accounts.balance_mp` 有 `CHECK (balance_mp>=0)`（[02 §3.2](02-database.md)）兜底——任何让余额变负的减扣都会被 DB 拒绝，是「不出负」最后防线。
>
> **🔴 adjust 红线（防对账反转）**：adjust 必须在**同一事务内同时改 `credit_lots`（增=建批次 / 减=FIFO 扣 remaining）与物化余额 `credit_accounts`**——绝不能只动物化余额。否则余额对账 cron（[10-ops-test.md §11.3](10-ops-test.md)）以 `SUM(credit_lots.remaining)` 为准，会把"只改了余额没动批次"的调整**当成漂移修回去、悄悄抵消本次 adjust**。账本 `amount_mp`、`events.amountMp`、审计 `before/after` 三者一律取**本次真实移动量 `moved`**与 `RETURNING` 真值，保证「账本 = lots 实动 = 物化余额变化」恒等。

---

## 10.4 灵感库 CRUD

对应 wireframes 14/17。**本期封面 = admin 贴公有 URL（`cover_url`）**（multipart 上传落存储 + 自动 `cover_key` 留增强）；前台展示在 [08-frontend.md §9.6](08-frontend.md)，读路径契约见 [07-api.md §8.3 灵感库](07-api.md)。

### 表 `inspirations`（§16 灵感库 CRUD；迁移 `drizzle/0001_inspirations.sql` + `drizzle/0002_inspirations_dims.sql`）

> 规格 [§16](../redesign-requirements.md) 未独立列灵感库表 DDL；按 §9 字段建表，与其它表同风格（金额无关，无 mp）：

```sql
CREATE TABLE inspirations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  cover_key   text,                     -- 存储内部 key（multipart 上传时填；贴 URL 时可空）
  cover_url   text NOT NULL,            -- 前端只读公有 URL（[06 §7.6](06-storage.md)）
  category    text,                     -- 品类标签（单值，本期）
  prompt      text NOT NULL,            -- 「用此提示词」一键带回的内容（§24-10）
  summary     text,                     -- 一行摘要
  width       int,                      -- 封面原始宽（瀑布流原比例预留盒、避免抖动；P3-S4 0002，可空）
  height      int,                      -- 封面原始高（同上，可空）
  sort        int  NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,  -- 是否上架（前台只展示 active）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_insp_active_sort ON inspirations(active, sort);
```

### 端点（单 `POST /api/admin/inspirations`，`op` 判别联合 [`contracts/admin.ts InspirationAction`](../../src/contracts/admin.ts)）

| 操作 | op | 要点 |
|---|---|---|
| 列表 | `GET /api/admin/inspirations` | 含未上架；按 `sort, created_at`；返回 `width/height` |
| 新增/编辑 | `create` / `update` | Zod 校验非空（title/prompt/cover）+ 可选 `width/height`；写 audit `target_type='inspiration'`。上下架=`update` 翻转 `active`（前端一键不开整表单） |
| 排序 | `reorder` | `{id, direction:'up'\|'down'}`：事务内取全表顺序 → 与相邻互换 → **规整 `sort=0..N-1`**（比对每行当前 sort≠新下标才写，去重去间隙；并列 sort 时仍正确）；边界 no-op |
| 删除 | `delete` | 硬删（封面为贴入 URL、无对象需清）+ 写 audit |

> 灵感库非钱/码、单语句即可，但 `create/update/reorder/delete` 均走 `tx()` 事务以与 `writeAudit` 同提交（增删改属内容运营，动作可审）。封面探测宽高（admin 表单「从封面探测」）为纯客户端 `Image` 加载回填，非端点。

---

## 10.5 生成记录列表

对应 §9 / §24-3。**纯记录、不做收录**（无「收录灵感库」按钮）。归一化失败原因来源 [04-generation-pipeline.md §5.8](04-generation-pipeline.md)。

### 端点（GET `/api/admin/generations`）

筛选与分页默认（§24-3）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `from` / `to` | **近 7 天** | 日期区间（按 `created_at`） |
| `userEmail` | 空 | 用户邮箱搜索（join `users`） |
| `status` | 全部 | 可选过滤 |
| `pageSize` | **50** | 一屏多条不下滑 |
| 排序 | `created_at DESC` | 生成时间倒序 |

```sql
SELECT g.id, g.prompt, g.size, g.status,
       g.error_code, g.error, g.http_status,         -- 失败三列直显（[02 §3.2](02-database.md)）
       g.duration_ms, g.created_at,
       u.email, i.public_url AS thumb_url            -- 成功才有图
FROM generations g
JOIN users u  ON u.id = g.user_id
LEFT JOIN images i ON i.generation_id = g.id
WHERE g.created_at >= $from AND g.created_at < $to
  AND ($email IS NULL OR u.email ILIKE '%'||$email||'%')
ORDER BY g.created_at DESC
LIMIT $pageSize OFFSET $offset;
-- 配套 count(*) 取 total
```

### 展示规则

- 列：**缩略图 + 用户邮箱 + 生图时长(`duration_ms` → `M:SS`) + 提示词 + 状态 + 时间**。
- 点缩略图 → **全局 lightbox**（[08-frontend.md §9.6](08-frontend.md) 通用浮层，仅「下载」，[§19](../redesign-requirements.md) 通用 lightbox）。
- **失败行直显三列 `error_code` / `error` / `http_status`**。system 展示 [§5.8](04-generation-pipeline.md) 七值既有语义，custom 展示 [07 §8.7](07-api.md) 十值；读取取并集，`error` 是脱敏人读串。
- 缩略图只读数据库 `public_url`（自托管默认 `/media/*`，见 [06 §7.6](06-storage.md)），失败行无图占灰位。

---

## 10.6 套餐与全局参数与审计

### 套餐 CRUD（GET/POST/PUT/DELETE `/api/admin/packages`）

字段对齐 [02 §3.2](02-database.md) `packages` + 规格 §9：

| 字段 | 列 | 校验（§24-13） |
|---|---|---|
| 标题 | `title` | 非空 |
| 描述（适用场景，前台 2 行） | `description` | 可空、多行 |
| 价格（分） | `price_cash` | `>0` |
| 积分（mp） | `credits_mp` | `>0`（10 积分=10000mp） |
| 有效期（天，可永久） | `valid_days` | `≥1` 或 NULL=永久 |
| 跳转 URL | `redirect_url` | 可空占位 |
| 排序 / 上架 | `sort` / `active` | — |

> 改套餐**不回溯已发码**——`redeem_codes` 入库即快照了 `credits_value_mp/cash_value/valid_days`（[02 §3.2](02-database.md) 注释、§10.2 生成时落快照）。**删套餐用软删 `active=false`，禁止硬删**：`redeem_codes.package_id` FK **默认 `ON DELETE RESTRICT`**，有码引用时硬删会被 DB 拒；**切勿改成 `ON DELETE CASCADE`**（会连带删掉历史兑换码、销毁账目）。

### 全局参数（GET/PUT `/api/admin/config`）

读写 `app_config(key, value_json)`（[02 §3.2](02-database.md)），覆盖 [00 §1.5](00-overview.md) 全部参数：

| key | 默认 | 校验（§24-13） |
|---|---|---|
| `price_per_image_mp` | 70 | `>0` |
| `signup_grant_mp` | 140 | `≥0` |
| `signup_grant_valid_days` | 30 | `≥1` 或永久 |
| `retention_free_days` | 7 | `≥1` |
| `retention_paid_days` | 60 | `≥1` |
| `default_max_concurrency` | 2 | `≥1` |
| `daily_relay_budget_calls` / `_ms` | env 起始 | `>0`（铁律①，[04 §5.6](04-generation-pipeline.md)） |
| `relay_base_url` | env 起始 | 可切备用 Base（[00 §1.4](00-overview.md)） |

改完即生效（业务运行时读 `app_config`，不写死）。

### 敏感操作 = 二次确认 + 审计（§24-13 / §9 / wireframes）

**所有敏感写操作必须**：① 前端**二次确认弹窗**；② 服务端在**同事务内**写 `audit_log`（before/after/ip/reason）。覆盖范围：

> 调积分 · 改密 · 封禁/解封 · 生成码/作废批次 · 改配置（定价/赠送/保留期/并发/预算/Base）· 改套餐文案与定价。

`audit_log` 写入助手（[02 §3.2](02-database.md) 表）：

```ts
async function writeAudit(c, e: {
  adminId: string; action: string;       // adjust_credit|reset_pw|ban|unban|gen_codes|disable_batch|edit_config|edit_package|...
  targetType?: string;                   // user|code|package|inspiration|config
  targetId?: string; before?: unknown; after?: unknown; ip?: string; reason?: string;
}) {
  await c.query(
    `INSERT INTO audit_log(admin_id,action,target_type,target_id,before,after,ip,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.adminId, e.action, e.targetType, e.targetId, e.before ?? null, e.after ?? null, e.ip, e.reason]);
}
// 仅在 TRUST_PROXY=true 时读取 Caddy 写入的 x-forwarded-for 首段
```

**审计红线（§9 / §24-13）**：
- **只追加**：`audit_log` 无 UPDATE/DELETE 端点；管理员**不可删改记录**（尤其自己的）。
- 改密 / 含密码的操作 `before/after` **绝不落明文**（只标 `{changed:true}`）。
- 钱类操作的 `audit_log` 写在**同一钱事务内**（与流水一起 COMMIT/ROLLBACK），不留「改了钱但没审计」的窗口。
- 审计列表只读视图（GET `/api/admin/audit`，按时间倒序、可按 admin/action/target 筛）。

---

## 10.7 数据看板

本期 7 卡 + 附加指标，**全部从 `events` 表聚合**（[02 §3.2](02-database.md) append-only 事实表，job/历史清理后不丢数据）。看板通过 `getSql()` 只读；**`SUM()`/`count` 大聚合用 string codec 再换算**（mp 求和可能超 `2^53`，见 [10-ops-test.md](10-ops-test.md)）。

> 事实事件由钱/生图链路写入：`user_registered` / `image_succeeded`(payload.durationMs) / `image_failed`(payload.reason) / `code_redeemed`(payload.cashValue 面值) / `credit_granted` / `credit_consumed` / `credit_expired`（[03](03-money.md) 各事务、[04](04-generation-pipeline.md)）。

「今日」= `created_at >= date_trunc('day', now())`（落地按站点时区，建议存储 UTC、聚合时 `AT TIME ZONE`）。

| 卡 | 指标 | 聚合 SQL 思路（events） |
|---|---|---|
| ① 今日注册 | 今日新号 | `count(*) WHERE type='user_registered' AND today` |
| ② 今日成功/失败 + 失败 Top | 成败计数 + 失败原因排行 | 成功/失败按 events 统计；Top 按 `payload->>'reason'` 聚合；system 七值、custom 十值取并集，并按 `credential_mode` 下钻。 |
| ③ 累计总图 | 历史成功图 | `count(*) WHERE type='image_succeeded'` |
| ④ 今日/累计收入（面值现金） | 兑换面值之和（分） | `sum((payload->>'cashValue')::bigint)::text WHERE type='code_redeemed' [AND today]`（展示 `/100`） |
| ⑤ 积分发放 vs 消耗 + 账面负债 | grant/credit 分列、消耗、负债 | 发放 `sum((payload->>'amountMp')::bigint)::text WHERE type='credit_granted'`（按 `payload->>'source'` 分 signup/code/adjust）；消耗 `(sum(creditsChargedMp WHERE image_succeeded) + sum(amountMp WHERE credit_consumed))::text`（**口径修正**：生图扣费走 `image_succeeded`(payload.creditsChargedMp)、`credit_consumed` 仅 adjust 减额发——消耗=生图扣费+管理员减额；原写"仅 credit_consumed"会漏掉占绝大多数的生图消耗）；**账面负债 = 全站未过期 `credit_lots.remaining_mp` 之和**（直接查 lots：`sum(remaining_mp)::text WHERE remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`） |
| ⑥ 队列健康 | 待处理 / 运行中 | 直接查 `generations`（实时态非事实事件）：`count FILTER (status='queued')`、`count FILTER (status IN('claimed','running'))` |
| ⑦ 平均生图时长 | 成功图均时 | `avg((payload->>'durationMs')::numeric) WHERE type='image_succeeded' [AND today]`（或直接 `avg(duration_ms) FROM generations WHERE status='succeeded'`） |

附加指标：

| 指标 | 思路 |
|---|---|
| 付费转化率 | `count(DISTINCT user_id) WHERE type='code_redeemed'` ÷ 总注册数（或 `users.has_paid` 占比） |
| ARPU | 累计收入(④) ÷ 注册数 |
| DAU | `count(DISTINCT user_id) FROM events WHERE today`（活跃 = 当天有任意事件） |
| 尺寸占比 | 直接查 `generations`：`SELECT size, count(*) FROM generations WHERE status='succeeded' GROUP BY size`（模型固定 gpt-image-2，**不做模型占比**，[§3](../redesign-requirements.md)） |

> **三口径分工（统一裁决）**：① **余额/负债类快照查 `credit_lots`**（实时表，如账面负债 = 全站未过期 `remaining_mp` 之和）；② **资金流水/历史口径走 `events`**（append-only，不受清理影响，如发放/消耗/收入累计）；③ **运维实时口径查 `generations`**（要当前态，如队列健康、进行中并发）。所有 `SUM` 在 API 返回前以 string 取出再 `BigInt` 换算（见 [10-ops-test.md](10-ops-test.md)），避免 number 截断把钱算错。

---

## 10.8 Key 模式的后台可见性

- 生成记录新增 `credential_mode` 列/筛选。custom 成功显示扣费 `0`，system 继续显示实际 `credits_charged_mp`；不得把 custom 计入“积分消耗”，但成功图计数、失败率和时长仍计入总体。
- 失败枚举展示升级为 [07 §8.7](07-api.md) 全集。错误列只显示脱敏的人读文案与上游状态码，不显示 credential ID、Key hint、ciphertext、IV 或 auth tag。
- 管理员**无读取 custom Key 的能力**。`generation_credentials` 不提供列表/详情 API；运维最多看到密文孤儿数量、最老年龄与清理结果的聚合指标。
- 看板成本/可靠性按 `credential_mode` 拆分：system 观察预算、扣费、毛利；custom 观察 compute、DB、存储、失败率和并发任务量。全局队列健康可合计，但必须可按 mode 下钻。
- 现有“中转站配置”仍只管理 system 的 `app_config` URL/Key。custom 固定 URL 不是后台参数，不得增加可编辑入口。
- 审计日志可记录“管理员改 system relay 配置”，但任何 custom Key 的保存/切换是浏览器本地行为，不写审计或事件。

## 后台不变量

- `/admin/*` 使用布局 loader + 每个 API 的双重 `requireAdmin` 守卫。
- 兑换码使用 CSPRNG 与唯一约束，落套餐快照；作废只修改 active 码，收入只认已兑换面值。
- 调积分使用 adjust 流水、必填原因和 FIFO 锁扣；改密/封禁吊销会话。
- 敏感写二次确认并写 append-only `audit_log`，密码等秘密不入审计。
- 看板历史口径从 events 聚合，队列健康查实时表；SUM 使用 string/bigint codec。
- 生成记录区分 system/custom，但任何 admin API 与页面都不得返回 custom credential 材料。
- 灵感投稿审核使用 admin 双守卫、行锁、状态谓词、同事务审计与通知。
