# 1 · 技术栈总览 + 环境变量 / 密钥 / 配置

> 本章建立全局技术认知，并把**密钥隔离红线**（铁律④的安全面）刻清楚。逐项栈选型理由见规格 [§15](../redesign-requirements.md)，此处只写**研发要知道的落地形态**。

## 1.1 技术栈一览

| 层 | 选型 | 版本/形态 | 关键约束 |
|---|---|---|---|
| 部署/运行时 | **Netlify** | Functions（同步）+ **Background Functions**（15min）+ **Scheduled Functions**（cron） | 生图走 Background；cron 走 Scheduled；无独立服务器 |
| 队列（阶段一） | **DB-as-queue** | `generations` 表状态机 | 不引独立队列服务；抢占式中间态 + cron 兜底重扫 |
| 数据库 | **Neon Postgres** | region = **AWS 美东**（与 Netlify 函数同区，压低 RTT） | 钱/码走 Pool/WS 事务；看板走 HTTP |
| DB 驱动 | **`@neondatabase/serverless`** | `Pool`/`neonConfig`（WS）+ `neon()`（HTTP） | 见 §1.3 调用模式 |
| ORM | **Drizzle** + **drizzle-kit** | schema-first，迁移用 `drizzle-kit generate` | 关键幂等约束（部分唯一索引）**手写 SQL 校对**，不全靠 ORM 推断 |
| 前端框架 | **React Router 7** | **framework 模式**（loader/action/SSR）+ Vite + React 19 | 路由即文件；server loader 直连 DB |
| 鉴权 | **Better Auth** | email+password + **admin 插件** + bcryptjs；钉版避 multi-session CVE | DB 可吊销会话；敏感路径每请求查 DB（不吃 cookieCache） |
| 对象存储 | **Cloudflare R2** | 公有 bucket + 不可枚举 key + 自定义域 | S3 兼容、零出口费；DB 存 `storage_key + public_url` |
| API 风格 | **手写 REST** | 提交 `202 + generationId` → 前端**批量短轮询当前会话非终态任务**；语义化状态码 | 不上 SSE/WebSocket；允许多任务 |
| 数据获取 | **TanStack Query v5** | 查询缓存 + 短轮询 `refetchInterval` | 余额/job 态/列表统一走它 |
| 校验/契约 | **Zod 4** + **drizzle-zod** | 放 `src/contracts`，前后端单一真相源 | 请求/响应 schema 复用 |
| 样式 | **tokens.css** + **CSS Modules** | tokens 从 design-system.html 落地 | 取色/间距/圆角一律引 CSS 变量，不硬编码 |
| 质量 | **Vitest**（真 Neon 分支测钱链路）+ **Playwright** 冒烟 + **Biome** + **Sentry** + **GitHub Actions** | — | 钱链路必须对真库跑事务测试 |

**已排除**（不要再提）：Next.js / TanStack Start、MySQL / PlanetScale（缺部分唯一索引 + `RETURNING`、serverless 生态弱）、Supabase（鉴权/存储已另选）、Refine（后台自建贴 design-system）。

## 1.2 Netlify 函数三态（生图为什么必须 Background）

| 函数类型 | 文件后缀/约定 | 时长上限 | 用途 |
|---|---|---|---|
| 同步 Function | `netlify/functions/x.ts` | 10s（默认）/ 26s（上限） | 提交入队、状态查询、兑换、后台 API、鉴权回调 |
| **Background Function** | `netlify/functions/x-background.ts`（**`-background` 文件名后缀**），**或**（Functions v2）函数内 `export const config = { background: true }`——**二者其一**；官方推荐后者，后缀仍受支持 | **15 min** | 跑 5min 生图（长 await 中转） |
| **Scheduled Function** | `netlify.toml` 配 `[functions.x] schedule="..."` 或导出 `config.schedule` | 按 cron | 超时兜底重扫、积分过期、图片清理、余额对账、旧预算键清理 |

> ⚠️ 同步函数 10/26s 会被生图打超时——**这是现存 `generate.ts` 的硬伤**（它用 `fetch` 主动调后台，不是真 Background）。修法见 [04-generation-pipeline.md §5.7](04-generation-pipeline.md)。

## 1.3 Neon 两种调用模式（用错幂等会落空）

```ts
// ① 事务模式（钱/码必用）—— Pool over WebSocket，支持跨语句事务 + FOR UPDATE
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;           // Node 运行时需注入 ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED });
// 单 handler 内：开 client → BEGIN → … → COMMIT/ROLLBACK → client.release() → pool.end()
// 绝不跨请求复用 client/pool（serverless 无常驻进程）

// ② HTTP 模式（兑换单语句 / 看板只读聚合）—— 单次往返、最快、但不支持事务/FOR UPDATE
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
await sql`UPDATE redeem_codes SET status='redeemed' WHERE code=${code} AND status='active' RETURNING credits_value`;
```

**铁律**：凡涉及"读-改-写多步且要防并发双花"（扣费 FIFO、注册原子发放、退款/调账），**必须走 ① 事务模式**；HTTP 单语句模式不支持 `FOR UPDATE`/跨语句事务，拿它防双花会落空。**单语句即原子**的（兑换核销 `UPDATE…RETURNING`）可走 ②。DB client **单 handler 内开-用-关、不跨请求复用**。

> **待压测定清**（开发文档遗留，不阻塞起步）：`DATABASE_URL`（pooled, PgBouncer）vs `DATABASE_URL_UNPOOLED`（direct）。`FOR UPDATE` 交互式事务**倾向 direct + 同区**（pooled 的事务级 pooling 对长事务/会话级锁有坑）；上线前压并发验证 `FOR UPDATE` 真锁、不撞 `max_connections`。看板 HTTP 走 pooled。

## 1.4 环境变量与密钥（铁律④的安全面 · 红线）

### 服务端变量清单（只在 Netlify 环境变量后台配置，**永不进前端**）

| 变量 | 用途 | 备注 |
|---|---|---|
| `RELAY_API_KEY` | system 中转 Bearer Key | **system 共享 Key**；只在 Background Function 注入。custom 用户 Key 走 §1.6 的受控链路 |
| `RELAY_BASE_URL` | 中转 base（`https://api.tangguo.xin/v1`） | 后台可切**备用 Base**（§22 故障兜底）→ 后续可移 DB 配置 |
| `DATABASE_URL` | Neon **pooled**（看板/只读） | PgBouncer endpoint |
| `DATABASE_URL_UNPOOLED` | Neon **direct**（钱/码事务） | direct endpoint，跑 `FOR UPDATE` |
| `BETTER_AUTH_SECRET` | 会话签名密钥 | 32+ 字节随机 |
| `BETTER_AUTH_URL` | 站点 URL | Better Auth baseURL |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 S3 凭据 | 仅落图函数用 |
| `R2_BUCKET` | bucket 名 | 公有 bucket |
| `R2_PUBLIC_BASE_URL` | R2 自定义公有域（如 `https://img.example.com`） | 拼 `public_url`；前端只读它 |
| `DAILY_RELAY_BUDGET_CALLS` / `DAILY_RELAY_BUDGET_MS` | 单日预算熔断阈值 | 铁律① |
| `SENTRY_DSN` | 错误上报 | 服务端 DSN |
| `ADMIN_ALERT_WEBHOOK` | 告警出口（熔断/对账不平/队列积压） | 见 [10](10-ops-test.md) |

### 前端可见变量（仅这些可带 `VITE_` 前缀进 bundle）

- `VITE_SENTRY_DSN_CLIENT`（前端 Sentry，可选）
- `VITE_APP_NAME` 之类纯展示常量

> **任何含 Key/连接串的变量都不得加 `VITE_` 前缀**——Vite 只把 `VITE_*` 暴露给前端，但**人为失误是主要泄露源**，故加构建期断言兜底。

### 构建期断言（必做 · CI 拦截）

`scripts/assert-no-secrets-in-bundle.ts`：`vite build` 后扫 `dist/` 全部产物，断言**不出现** `RELAY_API_KEY`/`RELAY_BASE_URL`/`DATABASE_URL`/`R2_SECRET_*`/`BETTER_AUTH_SECRET` 的值与名；命中即 `process.exit(1)`。挂进 GitHub Actions 的 build 步骤后，PR 无法合入泄露代码。

```ts
// 伪代码
const FORBIDDEN = [process.env.RELAY_API_KEY, process.env.DATABASE_URL, /* …其余真值 */].filter(Boolean);
for (const file of walk('dist')) {
  const text = readFileSync(file, 'utf8');
  for (const secret of FORBIDDEN) if (text.includes(secret)) fail(`secret leaked into ${file}`);
}
```

### 密钥流向红线（v1 清理基线 + 2026-07-11 受控例外）

- v1 无用户隔离的 `apiKey` 全链路必须保持删除；system Key、数据库/存储/鉴权 secret 仍**永不**上送、永不进 bundle。
- custom Key 是批准的唯一例外：按登录 user ID 明文存浏览器 `localStorage`，只在 custom 模式随 HTTPS `POST /api/generate` 请求体发送；固定 Base URL 不从客户端发送。
- 服务端收到 custom Key 后立即加密为 generation-scoped 临时凭据；`generate-background` 载荷只含 `generationId`，普通 generation/job 字段不传 Key。
- system 中转调用解析服务端 `app_config`/env；custom 中转调用解密本 generation 的临时 Key。两者都只在 Background Function 内使用明文。
- 任何回前端/后台、落库或上报的中转响应和报错先用**本次实际 Key**脱敏；终态删除临时凭据，15 分钟仅作异常孤儿兜底。
- 详细改造点见 [04-generation-pipeline.md §5.7](04-generation-pipeline.md) 与 [11-structure-roadmap.md](11-structure-roadmap.md)。

## 1.5 全局参数（运行时可调，存 DB 不写死）

后台「全局参数」（见 [09-admin.md](09-admin.md)）落 DB（建议单行 `settings` 表或 KV 风格 `app_config(key,value_json)`），研发**不写死**这些值，启动时读、后台改完即生效：

| 参数 | 默认 | 校验 |
|---|---|---|
| 单张扣费价（mp） | `70`（0.07） | `>0` |
| 新用户赠送额（mp） | `140`（0.14） | `≥0` |
| 新用户赠送有效期（天） | `30` | `≥1` 或永久 |
| 免费保留期（天） | `7` | `≥1` |
| 付费保留期（天） | `60` | `≥1` |
| 默认并发（仅 system） | `2` | `≥1`（逐用户可在 `users.max_concurrency` 覆盖） |
| 单日预算阈值（仅 system） | env 起始、后续可移 DB | `>0` |

> 改这些参数属管理员敏感操作，**二次确认 + 写 `audit_log`**（[09-admin.md](09-admin.md) §10.6）。

## 1.6 2026-07-11 Key 模式配置增补

| 配置 | 所在位置 | 约束 |
|---|---|---|
| system Base URL / Key | 现有 `app_config`，`RELAY_*` env 兜底 | 仅服务端；管理员读取只回 Key hint |
| custom Base URL | 服务端常量 `https://api.tangguo.xin/v1` | UI 可只读显示；客户端请求不得携带/覆盖 |
| custom 用户 Key | `localStorage`，键名包含稳定 user ID | 明文、无跨设备同步；保存仅校验非空/最大长度 |
| `CUSTOM_KEY_JOB_ENCRYPTION_KEY` | Netlify env，仅服务端 | **实施时新增**；32 字节随机主密钥（建议 base64），用于 AES-256-GCM 任务临时凭据，不用于浏览器存储 |

- 不在当前文档同步阶段改 `.env.example`：业务代码尚未读取新变量。实现 Task 完成时再同步 env 模板、部署站点和密钥轮换说明。
- 加密结果必须包含 `key_version`、随机 IV、ciphertext 与 auth tag；不得用固定 IV，不得把加密主密钥写入 DB。
- `assert-no-secrets` 继续验证静态 bundle；custom Key 需要额外运行时哨兵，因为它按设计会短暂存在于请求内存，不能靠静态扫描证明不泄露。
