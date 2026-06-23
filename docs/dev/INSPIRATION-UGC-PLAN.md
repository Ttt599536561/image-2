# 灵感库用户投稿与审核 — 开发文档（INSPIRATION-UGC-PLAN）

> 新需求 2026-06-23。**做什么**看规格 [redesign-requirements.md §13.1](../redesign-requirements.md)；**怎么写代码**看本文件。
> 状态在本文件「任务清单」维护（与 PROGRESS 同步）。红线沿用 `.claude/rules/`（钱/客户端/后台）。

## 0. 一句话

用户在灵感库点「投稿」→ 从**自己的作品**里选一张图、填标题/提示词/分类/简介 → 落 `inspiration_submissions(status=pending)` + **复制一份永久副本** → 管理员在后台「灵感投稿」队列**通过**（建 `inspirations` 上架卡 + 署名）或**驳回**（填原因）→ 给投稿人发站内通知。**不扣积分**。

四项产品决策（站长拍板）：① 图来源=仅「我的作品」② 用户填完整信息（管理员可改）③ 入口=灵感库页「投稿」按钮 ④ 公开卡片显示投稿人（邮箱前缀掩码）。

## 1. 数据模型（迁移 0004）

**新表 `inspiration_submissions`**（投稿队列；与 `inspirations` 上架表分离，确保用户端只读路径 `loadInspirations(active=true)` 零改动、不泄露 pending/rejected）：

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| user_id | uuid NOT NULL | 投稿人（cascade on users delete） |
| source_image_id | uuid | 来源 `images.id`（可空：用户日后删原图不影响投稿副本） |
| image_key | text NOT NULL | 投稿图**永久副本** key（`inspirations/submissions/<uid>/<yyyy>/<mm>/<uuid>.<ext>`） |
| image_url | text NOT NULL | 副本公有 URL（前端只读） |
| width / height | integer | 原图宽高（瀑布流原比例） |
| title | text NOT NULL | 用户填 |
| prompt | text NOT NULL | 默认预填原图 prompt、用户可改 |
| category | text | 可选 |
| summary | text | 可选 |
| status | text NOT NULL default 'pending' | `pending` / `approved` / `rejected`（CHECK） |
| review_reason | text | 驳回原因（或备注） |
| reviewed_by | uuid | 审核管理员 id |
| reviewed_at | timestamptz | |
| published_inspiration_id | uuid | 通过时建的 `inspirations.id` |
| created_at / updated_at | timestamptz default now() | |

索引：`ix_insp_sub_status_time (status, created_at)`（审核队列）、`ix_insp_sub_user_time (user_id, created_at DESC)`（我的投稿）。

**`inspirations` 加两列**（署名）：
- `submitted_by uuid`（可空；投稿人 id，仅供审计/追溯，**不下发客户端**）
- `submitter_name text`（可空；**审核通过时冻结**的掩码昵称，如 `qk***`；NULL=站长自建、不显署名）

迁移文件 `drizzle/0004_inspiration_submissions.sql`（幂等 `IF NOT EXISTS`）+ 应用脚本 `scripts/migrate-inspiration-submissions.ts`（仿 `migrate-input-image-key.ts`：读 SQL → `pool.connect()` → `c.query(ddl)` → 校验列存在）。同步更新 `src/db/schema.ts`（新表 + 两列，drizzle 平价；非钱表无部分唯一索引，免人工核对 WHERE）。

> ⚠️ 生产与本地**同一 Neon 库**。迁移是 additive/幂等，低风险；上线前在本地跑一次 migrate 脚本即同时作用于生产库（见 §8 部署）。

## 2. 存储（`src/server/r2.server.ts`）

新增 **投稿副本复制** helper（provider-neutral：GetObject 取字节 → PutObject 落永久 key，不依赖 S3 CopyObject 在 Supabase 的可用性）：

```ts
export function buildInspirationSubmissionKey(userId: string, ext: string): string {
  // inspirations/submissions/<uid>/<yyyy>/<mm>/<uuid>.<ext>
}
export async function copyToInspirationSubmission(
  srcKey: string, userId: string,
): Promise<{ storageKey: string; publicUrl: string; contentType: string; bytes: number }> {
  // GetObject(srcKey) → 取 bytes + contentType → putObject(newKey) → 返回 {storageKey, publicUrl, ...}
}
```

- 前缀 `inspirations/submissions/…` **以 `inspirations/` 开头** → `deriveCoverKey()`（`k.startsWith("inspirations/")`）天然接受，通过后 `inspirations.cover_key` 复用同一副本对象、无需再复制。
- 复用现有 `putObject`（CacheControl immutable）+ `getR2Client().send(GetObjectCommand)`（同 `getUploadObject`）。
- 测试可注入 `copy` 桩（见 §6），免烧 Supabase。

## 3. 契约（client-safe，手写 Zod，绝不 import db/schema）

**`src/contracts/inspirationSubmission.ts`（新）— 用户端：**
```ts
InspirationSubmitRequest = z.object({
  imageId: z.uuid(),
  title: z.string().min(1).max(100),
  prompt: z.string().min(1).max(4000),
  category: z.string().max(50).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
});
InspirationSubmitResponse = z.object({ id: z.uuid(), status: z.literal("pending") });
MySubmissionItem = z.object({
  id, image: z.string(), title, prompt, category(nullable), summary(nullable),
  status: z.enum(["pending","approved","rejected"]), reviewReason: z.string().nullable(), createdAt: z.string(),
});
MySubmissionsResponse = z.object({ items: z.array(MySubmissionItem) });
export const INSPIRATION_SUBMISSION_MAX_PENDING = 10;       // 待审上限
export const INSPIRATION_SUBMISSION_RATE_PER_WINDOW = 10;   // 10 次 / 10 分钟（events 计数）
```

**`src/contracts/inspiration.ts` 改** — `InspirationItem` 加 `submitter: z.string().nullable()`（公开掩码昵称；null=站长自建）。

**`src/contracts/notification.ts` 改** — `type` 枚举加 `"inspiration_reviewed"`（payload `{status:'approved'|'rejected', title, reason?, inspirationId?}`）。`notifications.type` 为纯 text 无 CHECK，**免迁移**。

**`src/contracts/admin.ts` 改** — 加投稿审核动作：
```ts
ApproveSubmissionAction = z.object({ op: z.literal("approve"), id: z.uuid(),
  title, prompt, category?, summary?, active? });  // 复用 inspFields 的字段约束（无 cover/width/height，来自投稿图）
RejectSubmissionAction  = z.object({ op: z.literal("reject"),  id: z.uuid(), reason: z.string().min(1).max(500) });
SubmissionReviewAction  = z.discriminatedUnion("op", [ApproveSubmissionAction, RejectSubmissionAction]);
```

## 4. 服务端

**`src/lib/publicHandle.ts`（新，纯函数）：** `publicHandleFromEmail(email)` → 取 `@` 前 local：`len<=1 ? local+"***" : local.slice(0,2)+"***"`。隐私默认，不暴露完整邮箱。

**`src/server/inspirationSubmissions.server.ts`（新）— 用户端：**
- `submitInspiration(userId, input, deps?)`：
  1. **限流**：`events` 近 10min `type='inspiration_submit'` 计数 ≥ `RATE_PER_WINDOW` → 抛 429。
  2. **待审上限**：`COUNT(*) WHERE user_id AND status='pending'` ≥ `MAX_PENDING` → 抛 429「待审投稿过多」。
  3. **归属校验**：`SELECT storage_key, public_url, width, height FROM images WHERE id=imageId AND user_id=$me`，无 → 404。
  4. **同图去重**：该 `source_image_id` 已有本人 `pending|approved` 投稿 → 抛 409。
  5. **复制副本**：`deps.copy ?? copyToInspirationSubmission(storage_key, userId)`。
  6. INSERT `inspiration_submissions(... status='pending')` + `events('inspiration_submit')`。返回 `{id, status:'pending'}`。
  > 红线：image_key/url/宽高/source_image_id 全由服务端从 DB 取，**绝不信客户端**（owner-scope）。prompt/title/category/summary 来自客户端（已 Zod 限长）。
- `listMySubmissions(userId)`：owner-scoped 近 50 条，map → `MySubmissionItem`。

**`src/server/admin/inspirationReview.server.ts`（新）— 后台：**
- `listSubmissions({status?, page?, pageSize?})`：分页；含投稿人 email（管理员可见）、image_url、各字段、status、reviewReason、createdAt。`countPendingSubmissions()` 供导航红点。
- `approveSubmission({adminId, id, fields, ip})`：`tx()` 内——锁取 submission（`status` 必须 `pending`，否则 404/no-op 幂等）；取投稿人 email → `publicHandleFromEmail`；`INSERT inspirations(title,cover_url=image_url,cover_key=deriveCoverKey(image_url),category,prompt,summary,width,height,sort=0,active,submitted_by,submitter_name)`；`UPDATE inspiration_submissions SET status='approved', reviewed_by, reviewed_at=now(), published_inspiration_id`；`writeAudit(action='approve_inspiration_submission', targetType='inspiration_submission', before/after)`；插通知 `inspiration_reviewed`（dedupe_key=`inspiration_reviewed:<subId>`、`{status:'approved',title,inspirationId}`、ON CONFLICT DO NOTHING）。
- `rejectSubmission({adminId, id, reason, ip})`：`tx()` 内——submission 必须 `pending`；`UPDATE … status='rejected', review_reason, reviewed_by/at`；`writeAudit('reject_inspiration_submission')`；插通知（`{status:'rejected',title,reason}`）。驳回副本不再受保护，由孤儿 cron 回收。

**读路径 `src/server/reads.server.ts` 改** — `loadInspirations` 的 SQL SELECT 加 `submitter_name`，map `submitter: (r.submitter_name) ?? null`；种子路径补 `submitter: null`（在 `inspirations.server.ts` 的 `insp()` 加 `submitter: null`）。

## 5. API 路由

| 路由（新） | 方法 | 守卫 | 作用 |
|---|---|---|---|
| `app/routes/api.inspiration-submissions.ts` | POST | `requireUserStrict` | 提交投稿（parse `InspirationSubmitRequest`） |
|  | GET | `requireUserStrict` | 我的投稿列表（`listMySubmissions`） |
| `app/routes/api.admin.inspiration-submissions.ts` | GET | `requireAdmin` | 队列（`listSubmissions` + 待审计数） |
|  | POST | `requireAdmin` | 审核（parse `SubmissionReviewAction` → approve/reject） |

错误形状沿用 `httpError(status, CODE, msg)`；`e instanceof Response` 冒泡。RATE_LIMITED/409 用既有错误码（409 用 `INVALID_PARAM` 或新增 `DUPLICATE`——本期用既有 `INVALID_PARAM` 即可，文案区分）。

## 6. 前端

**`src/contracts` → hooks**：`src/hooks/queries.ts` 加 `useMySubmissions()`（key `["my-submissions"]`）。`api-client` 已有 `apiGet/apiPost`。

**用户端**：
- `src/components/inspiration/SubmitInspirationModal.tsx`（新）：弹窗。左/上=从「我的作品」选图（复用 `useAssets({range:"all"})` 拉缩略图网格，点选一张）；右/下=表单（标题必填、提示词预填该图 `prompt` 可改、分类下拉=`INSPIRATION_CATEGORIES` 去「全部」、简介）。提交 `apiPost("/api/inspiration-submissions", InspirationSubmitRequest)` → toast「投稿已提交，待管理员审核」→ 关闭 + invalidate `["my-submissions"]`。含「我的投稿」区（`useMySubmissions` 列表 + 状态徽标 待审/已通过/已驳回+原因；rejected 缩略图 `onError` 兜底隐藏）。提示语：「投稿通过后将公开展示并署名你的昵称（邮箱前缀）」。
- `src/components/inspiration/InspirationPage.tsx` 改：标题行加「投稿」按钮 → 开 Modal。
- `src/components/InspirationGallery/InspirationGallery.tsx` 改：卡片浮层在标题下显示 `item.submitter ? "由 {submitter} 投稿" : null`（小字、低调）。

**后台**：
- `app/routes/_admin.inspiration-submissions.tsx`（新）：loader `requireAdminPage` + `listSubmissions(status)`；页面=状态筛选 Tab（待审/已通过/已驳回/全部）+ 表格（缩略图点放大、提交人、标题、提示词、分类、时间、状态）。每条 pending：「通过」（弹编辑表单：title/prompt/category/summary/active → 二次确认 → `apiPost approve`）、「驳回」（原因输入 → 二次确认 → `apiPost reject`）。成功 `revalidator.revalidate()`。
- `app/routes/_admin.tsx` NAV 加 `{ to:"/admin/inspiration-submissions", label:"灵感投稿", icon: Inbox }`（待审数红点：loader/轮询拿 `countPendingSubmissions`，简化版可在该页内显示）。

## 7. cron / 孤儿保护（`src/server/maintenance.server.ts`）

`sweepOrphanR2Objects` 的 known-set UNION **新增一支**：
```sql
UNION
SELECT image_key AS k FROM inspiration_submissions
  WHERE image_key = ANY(${keys}::text[]) AND status = 'pending'
```
语义：**pending** 副本受保护（防 1h 后误删）；**approved** 由 `inspirations.cover_key` 保护（通过事务把 cover_key 设为同一 key）；**rejected** 不在 known → 按孤儿(>1h)回收。

## 8. 测试 & 上线闸

- `tsc`（typecheck）0 错。
- `assert-no-secrets` PASS（新契约手写 Zod、组件不 import db）。
- **cron-smoke 扩**（`scripts/cron-smoke.ts` 加 7d 段）：pending 投稿副本受保护不删；rejected 投稿副本按孤儿回收。
- **新 smoke `scripts/inspiration-submissions-smoke.ts`**（真 Neon，注入 copy 桩免烧存储）：submit 建行 + 限流/上限/去重；approve → 建 `inspirations`（active+署名）+ submission=approved + 通知 + published id；reject → rejected + 原因 + 通知。owner-scope/越权 imageId→404。
- `test:run` / `test:money` 不回归（本特性不碰钱链路；若加 vitest 用例放 `tests/`）。
- `build` 0 错。
- **部署**：`scripts/migrate-inspiration-submissions.ts` 应用 0004（同时作用生产库）→ `netlify deploy --prod`（runbook 见 [deploy.md](deploy.md)；token 读 `.env`，`--site 8d1419c8-…`）。

## 9. 任务清单（每做完当场勾选；与 PROGRESS 同步）

- [x] 迁移 0004 SQL + migrate 脚本 + `schema.ts` 平价（新表 + inspirations 两列）+ **审查后补**：`user_id` FK(cascade) + `uq_insp_sub_pending_src` 部分唯一索引
- [x] `r2.server`：`buildInspirationSubmissionKey` + `copyToInspirationSubmission`
- [x] `lib/publicHandle.ts`
- [x] 契约：`inspirationSubmission.ts` 新；`inspiration.ts`+submitter；`notification.ts`+类型；`admin.ts`+审核动作
- [x] server：`inspirationSubmissions.server`（submit/listMine）+ `admin/inspirationReview.server`（list/approve/reject/count）
- [x] `reads.server.loadInspirations` 下发 submitter + 种子补 null
- [x] API：`api.inspiration-submissions`（POST/GET）+ `api.admin.inspiration-submissions`（GET/POST）
- [x] cron 孤儿 known-set 加 pending 投稿保护
- [x] 前端：SubmitInspirationModal + InspirationPage 投稿按钮 + Gallery 署名
- [x] 后台：`_admin.inspiration-submissions` 页 + NAV「灵感投稿」+ 待审红点
- [x] hooks：`useMySubmissions`
- [x] 测试代码：cron-smoke 7d + inspiration-submissions-smoke（已写+扩 resubmit/唯一索引用例）；**tsc 0 · test:run 78 · build 0 · assert-no-secrets PASS(116)** 全绿。⏳ 两个对真 Neon 的 smoke **待迁移应用后**才能跑（需 `.env` 配 `DATABASE_URL`）
- [x] 对抗审查（多代理，63 agents/28 发现→10 confirmed，去重后 **4 个不同问题**）→ 全修：① 同图去重 TOCTOU（部分唯一索引 pending + catch 23505）② schema↔迁移 FK 漂移（补 0004 FK）③ 删上架卡后无法重投（dup-check 放行已删卡的 approved）④ 选图仅最近 50 张（pageSize:200）。disputed 6 条=「copy-before-commit 孤儿」既有设计(WAD) + window.alert nit(与姊妹页一致)，未改。
- [ ] **应用迁移 + 部署生产 + 验收**（⏳ 站长拍板：① `.env` 补 `DATABASE_URL` ② 跑 migrate 0004 + 两个 smoke 对真 Neon ③ `netlify deploy --prod`）
