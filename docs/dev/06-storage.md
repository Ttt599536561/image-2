# 7 · 对象存储与媒体

> 结果图从中转临时 URL/base64 **落到 Cloudflare R2**（S3 兼容、零出口费），DB 只存 `storage_key + public_url`，前端永远读稳定 `public_url`。
> 规则真相源：规格 [§6.1](../redesign-requirements.md)（保留期 7/60、升级顺延、过期清理/提醒）/ [§12](../redesign-requirements.md)（资产库只展示自己生成的图、本期不支持上传）/ [§15 第二步](../redesign-requirements.md)（对象存储选型）。
> 工程上落图嵌在扣费链路里：落图在**扣费事务外**先做，结果存临时变量，再开扣费事务（[03-money.md §4.3](03-money.md)）。

## 7.1 R2 配置

R2 = Cloudflare 对象存储，**S3 兼容 API + 零出口费（egress 免费）**，正好匹配「前端高频读图、不想付带宽」的场景。落地形态：

| 项 | 配置 | 说明 |
|---|---|---|
| bucket | **公有 bucket** | 图片无隐私分级，公开可读；不签名、不鉴权 |
| 公有访问 | **自定义公有域**（如 `https://img.example.com`） | 绑到 bucket，**不要**用 `*.r2.dev` 默认域（有限流、不适生产）；前端读的就是这个域 |
| 防枚举 | **不可枚举 key**（§7.2 随机段） | 公有但「猜不到别人的图」，等价软隔离 |
| 写入 | **S3 兼容 endpoint**（`https://<account_id>.r2.cloudflarestorage.com`）+ Access Key | 仅 Background Function 落图时用 |

### 凭据 env（全部服务端，永不进前端 · 引 [00-overview.md §1.4](00-overview.md)）

| 变量 | 用途 |
|---|---|
| `R2_ACCOUNT_ID` | 拼 S3 endpoint：`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | S3 兼容凭据（R2 API Token 生成），**仅落图函数用** |
| `R2_BUCKET` | bucket 名 |
| `R2_PUBLIC_BASE_URL` | 自定义公有域（如 `https://img.example.com`）；拼 `public_url`、**前端只读它** |

> 这些都在密钥红线内：构建期断言 `R2_SECRET_*` 等绝不进 `dist/`（[00-overview.md §1.4](00-overview.md) 的 `assert-no-secrets-in-bundle.ts`）。`R2_PUBLIC_BASE_URL` 是公开域，但仍由服务端拼好 `public_url` 落库、前端直接读 DB 里的串，**不在前端拼 key**。

### S3 client 选型建议

| 方案 | 何时选 | 备注 |
|---|---|---|
| **`@aws-sdk/client-s3`**（推荐起步） | 直接、生态成熟、`PutObjectCommand` 即用 | 包体较大但 Background Function 冷启可接受；区域填 `auto` |
| `aws4fetch` | 想要极小依赖、只用 PUT/DELETE | 手写 SigV4，适合后续瘦身；本期非必需 |

`putObject` 调用骨架（`@aws-sdk/client-s3`）：

```ts
// src/server/r2.ts —— R2 客户端（仅服务端 import；前端 bundle 不得引入）
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable', // key 不可变 → 强缓存
  }));
}
```

## 7.2 key 设计（不可枚举 + 两字段分工）

公有 bucket 靠「**猜不到的 key**」做软隔离。`storage_key` 形如：

```
{userId}/{yyyy}/{mm}/{generationId}-{rand}.png
例： 7c1f.../2026/06/9a2e...-Xk7Qm3.png
```

- 前缀 `userId/yyyy/mm` 便于按用户/月做生命周期与排查；不靠它鉴权（公有可读）。
- `generationId` 让 key 与生成一一对应（落图幂等的天然锚）。
- 末尾 **`{rand}` 6–10 位随机段**（`crypto.randomBytes` base62）= 防枚举的关键：即使知道 userId/generationId，缺随机段也拼不出 URL。

**两个字段，各管一段，绝不混用**（落库见 [02-database.md §3.2](02-database.md) `images` 表）：

| 字段 | 值 | 谁用 |
|---|---|---|
| `images.storage_key` | R2 内部 key（上面那串） | **服务端**写入/删除（`PutObject`/`DeleteObjects`）时用 |
| `images.public_url` | `R2_PUBLIC_BASE_URL` + `/` + `storage_key` | **前端只读它**（§7.6 红线）；落库时一次拼好 |

```ts
function buildStorageKey(userId: string, generationId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const rand = randBase62(8); // crypto.randomBytes(6).toString('base64url') 取前 8 位
  return `${userId}/${yyyy}/${mm}/${generationId}-${rand}.png`;
}
const publicUrl = (key: string) => `${process.env.R2_PUBLIC_BASE_URL}/${key}`;
```

## 7.3 上传落图（在扣费事务外）

**顺序铁律（引 [03-money.md §4.3](03-money.md)）**：先 `putToR2`（事务外、结果存临时变量）→ 再开扣费单事务把 `images` 行和 `debit` 一起落。这样「图落 R2 成功 + 写库成功」共同定义"成功才扣"；R2 写成功但事务回滚留下的对象是孤儿，交清理 cron（§7.5）。

中转返回可能是**临时 URL** 或 **base64**，统一归一成字节后 PUT：

```ts
// 都在 generate-background 内、扣费事务之前调用
export interface PutResult {
  storageKey: string; publicUrl: string;
  contentType: string; width?: number; height?: number; sizeBytes: number;
}

async function fetchImageBytes(relay: { b64_json?: string; url?: string }): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (relay.b64_json) {
    return { bytes: Buffer.from(relay.b64_json, 'base64'), contentType: 'image/png' };
  }
  // 临时 URL：必须在中转链路活着时立刻取字节，绝不把它存进 DB（§7.6）
  const resp = await fetch(relay.url!);
  if (!resp.ok) throw new Error(`relay image fetch ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return { bytes: buf, contentType: resp.headers.get('content-type') ?? 'image/png' };
}

export async function putToR2(
  userId: string,
  generationId: string,
  relayImage: { b64_json?: string; url?: string },
): Promise<PutResult> {
  const { bytes, contentType } = await fetchImageBytes(relayImage);
  const storageKey = buildStorageKey(userId, generationId);
  await putObject(storageKey, bytes, contentType);
  const dims = readPngDims(bytes); // 可选：从 PNG 头读宽高，失败则留空
  return {
    storageKey,
    publicUrl: publicUrl(storageKey),
    contentType,
    width: dims?.width,
    height: dims?.height,
    sizeBytes: bytes.byteLength,
  };
}
```

返回的 `{ storageKey, publicUrl, contentType, width, height, sizeBytes }` 直接喂给 [03-money.md §4.3](03-money.md) 扣费事务的 `INSERT images(...)`。`expires_at` 在事务里由 `retentionExpiry(user, cfg)`（§7.4，`cfg` 取 `app_config` 的 `{ freeDays, paidDays }`）算出。

> **幂等**：`images.generation_id` UNIQUE + 扣费事务里 `ON CONFLICT (generation_id) DO NOTHING`（[03-money.md §4.3](03-money.md)）。平台重试若让同一 generation 二次落图，会多 PUT 一个新 `{rand}` key（孤儿，cron 清），但 DB 只认第一行——不会出现一张图两条 `images`。

## 7.4 保留期（免费 7 / 付费 60 · 升级顺延）

规格 [§6.1](../redesign-requirements.md)：免费用户图保留 **7 天**，付费（曾兑换过任意码，`users.has_paid=true`）保留 **60 天**；天数走全局参数（[00-overview.md §1.5](00-overview.md)，可后台改），不写死。落 `images.expires_at`。

```ts
// 落图扣费事务里给 images.expires_at 用
function retentionExpiry(user: { has_paid: boolean }, cfg: { freeDays: number; paidDays: number }): Date {
  const days = user.has_paid ? cfg.paidDays : cfg.freeDays; // 默认 60 / 7
  return new Date(Date.now() + days * 86_400_000);
}
```

**首次兑换升级 → 旧图统一顺延 60 天**：该 UPDATE 不在落图链路、而在**兑换事务内**（首次把 `has_paid: false→true` 那次触发，引 [03-money.md §4.7](03-money.md) 第 5 步）：

```sql
-- 兑换事务内，仅在 has_paid 由 false 翻 true 时执行一次：
UPDATE images
SET expires_at = GREATEST(COALESCE(expires_at, now()), now() + interval '60 days')
WHERE user_id = $1;
```

`GREATEST(...)` 保证「只延不缩」——已比 60 天还远的图不会被改短。此后该用户**新生成**的图，`retentionExpiry` 因 `has_paid=true` 直接给 60 天。

> **过期提醒不在本章**：缩略图角标「N 天后过期」（剩 ≤3 天才显示）+「下载保留」是前端行为，落 [08-frontend.md §9.6](08-frontend.md) + 交互默认值 [§24-5](../redesign-requirements.md)。**图片过期前 1 天的站内通知写入 `notifications` 表（[02-database.md §3.2](02-database.md)），由清理 cron 同族预扫触发**——清理 cron 在删图前先扫描 `images.expires_at` 临近（剩 ≤1 天）的行，`INSERT notifications(type='image_expiring', …)` 并以 `dedupe_key=image_expiring:{图id}` 去重（`ON CONFLICT DO NOTHING`，cron 重跑/每日不重发同一条），见 [10-ops-test.md §11.7](10-ops-test.md) 清理 cron 与通知整链。非前端、非本章逻辑（积分到期提醒走另一路：[07-api.md §8.3](07-api.md) MeResponse 的 `expiringSoon` 实时字段，不入此表）。本章只负责把 `expires_at` 算对、写对，前端据它渲染倒计时。

## 7.5 清理 cron（过期图 + 孤儿对象）

每日 Scheduled Function 跑两件事；**调度形态/时刻表在 [10-ops-test.md §11.7](10-ops-test.md)**，本节给清理逻辑与 SQL。

### A. 过期图清理（`expires_at < now()`）

流程：**先删 R2 对象、再删 DB 行**（顺序很关键：先删库后删 R2 若中途崩，会留下「DB 没记录、R2 还在」的孤儿，反而更难追）。批量、分页，每批 ≤ 500。

> **删前先核顺延（兜底顺延竞态漏网图）**：选中待删行后，对其中 `has_paid=true` 用户的图先核 `expires_at` 是否不足 60 天，若是则顺延到 60 天而非删除——兜底 [03-money.md §4.7](03-money.md) 首次兑换升级顺延与该用户在途落图并发时可能漏改的图（顺延竞态漏网）。该核查/顺延逻辑落在 [10-ops-test.md §11.7](10-ops-test.md) 清理 cron，本章只点明顺序：先顺延、剩下真过期的才进下面的删除批。

```ts
// scheduled: clean-expired-images（每日）
const sql = neon(process.env.DATABASE_URL!); // 读 + 删走 HTTP 即可（非钱事务）
const BATCH = 500;

while (true) {
  const rows = await sql`
    SELECT id, user_id, storage_key FROM images
    WHERE expires_at IS NOT NULL AND expires_at < now()
    ORDER BY expires_at ASC
    LIMIT ${BATCH}
  `;
  if (rows.length === 0) break;

  // 1) 删 R2 对象（批量 DeleteObjects，一次 ≤1000 key）
  await r2.send(new DeleteObjectsCommand({
    Bucket: process.env.R2_BUCKET!,
    Delete: { Objects: rows.map((r) => ({ Key: r.storage_key })) },
  }));

  // 2) 删 DB 行（generations 仍保留作历史/看板事实；只删 images 行）
  const ids = rows.map((r) => r.id);
  await sql`DELETE FROM images WHERE id = ANY(${ids})`;

  // 3) 写 events(image_cleaned) —— 看板/审计可追（events 是 append-only 事实表）
  await sql`
    INSERT INTO events(type, user_id, payload)
    SELECT 'image_cleaned', user_id, jsonb_build_object('imageId', id, 'storageKey', storage_key)
    FROM unnest(${ids}::uuid[], ${rows.map(r=>r.user_id)}::uuid[], ${rows.map(r=>r.storage_key)}::text[])
         AS t(id, user_id, storage_key)
  `; // 实现可简化为逐行/批量 INSERT；要点是每删一张写一条 image_cleaned
}
```

要点：
- 删 `images` 行即可（保留 `generations` 行做历史与看板事实，图字段已无意义但记录还在）；亦可改为**软删**（加 `images.deleted_at`）若产品要"图没了但记录在资产库灰显"——本期按硬删 + events 留痕。
- R2 删除失败不可让整批中断：catch 单 key 失败、记 event/告警、下轮重扫（`expires_at` 仍 < now 会被再选中）。

### B. 孤儿对象清理（扣费事务回滚后留在 R2 的图）

§7.3 顺序「先 PUT R2、后开事务」意味着：**事务 ROLLBACK 后那个 R2 对象没有对应 `images` 行** = 孤儿，否则永久占空间。识别 = R2 里有、DB `images.storage_key` 里没有的 key：

```ts
// scheduled: clean-orphan-r2（每日或每周；与 A 同一函数分两段亦可）
// 列 R2 对象（ListObjectsV2 分页），逐页比对 DB
// 只清「key 中 generationId 对应的 generation 已是 failed/不存在 images 行」且「对象 LastModified 早于 1h（避开正在落图的在途对象）」的 key
for await (const page of listR2Pages()) {           // ListObjectsV2 续传 ContinuationToken
  const keys = page.filter((o) => Date.now() - o.lastModified > 3600_000).map((o) => o.key);
  if (keys.length === 0) continue;
  const known = new Set(
    (await sql`SELECT storage_key FROM images WHERE storage_key = ANY(${keys})`).map((r) => r.storage_key),
  );
  const orphans = keys.filter((k) => !known.has(k));
  if (orphans.length) {
    await r2.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET!,
      Delete: { Objects: orphans.map((Key) => ({ Key })) },
    }));
    await sql`INSERT INTO events(type, payload) VALUES('image_cleaned', ${{ orphanCount: orphans.length }})`;
  }
}
```

`LastModified > 1h` 的保护窗口至关重要：**避免误删一张刚 PUT、事务还没 COMMIT 的在途图**。

## 7.6 前端只读红线

> **前端永远只读稳定 `public_url`（R2 自定义公有域），绝不读中转临时 URL。**

中转返回的 URL 是临时签名 URL（过几分钟/几小时即失效），base64 更不能当地址用。**只要任何一处前端图源指向中转 URL，历史/资产库就会整片裂图**（[01-architecture.md §2.1](01-architecture.md) 要点已点名此坑）。规则：

- 中转临时 URL/base64 **只在 Background Function 内**被 `putToR2` 消费一次（取字节），**绝不落 DB、绝不回前端**。
- DB `images.public_url` 是唯一稳定图源；前端所有读图面一律用它（loader/Query 返回的就是它）。

**读图的全部面（都只读 `public_url`）**：

| 面 | 数据来源 | 说明 |
|---|---|---|
| 对话流每轮结果 | `generations` join `images`（成功态） | [01-architecture.md §2.2](01-architecture.md) 短轮询成功后展示 |
| 本次对话图片面板 | `images WHERE conversation 内成功 generation` | 规格 [§11](../redesign-requirements.md) |
| 资产库 | `images WHERE user_id`（[02-database.md §3.3](02-database.md) `ix_img_user_time`） | 仅自己的图；本期不支持上传外部图 |
| 灵感库 | 站长后台上传的封面图（同样落 R2 + `public_url`） | 规格 [§12](../redesign-requirements.md) 站长维护 |
| 后台生成记录列表 | `generations` join `images` 小缩略图 | 失败行无图、显报错（规格 [§9](../redesign-requirements.md)） |

> 缩略图按需用 R2/CDN 的图片变换或前端 `loading="lazy"`；本期可直接用原图 + CSS 裁剪。前端组件细节见 [08-frontend.md §9.6](08-frontend.md)。

## 7.7 媒体红线清单（落地必守）

- [ ] 公有 bucket + **自定义公有域**（不用 `*.r2.dev`）；key 末尾带 `{rand}` 随机段防枚举。
- [ ] R2 凭据全在服务端 env，构建期断言不进 `dist/`（[00-overview.md §1.4](00-overview.md)）。
- [ ] 落图**先 PUT R2（事务外、存临时变量）→ 再开扣费事务**（[03-money.md §4.3](03-money.md)）；`images.generation_id` UNIQUE 幂等。
- [ ] `storage_key`（服务端写删用）与 `public_url`（前端只读）分工不混用；`public_url` 服务端一次拼好落库。
- [ ] `expires_at` = `retentionExpiry(user)`（免费 7 / 付费 60，走全局参数）；**首次兑换升级在兑换事务内 `GREATEST` 顺延旧图 60 天**（[03-money.md §4.7](03-money.md)）。
- [ ] 清理 cron：过期图**先删 R2、后删 DB**、写 `events(image_cleaned)`；孤儿清理只删「DB 无记录且 `LastModified>1h`」的对象。
- [ ] **前端绝不读中转临时 URL/base64**；五类读图面（对话流 / 本次对话图片面板 / 资产库 / 灵感库 / 后台生成记录，见 §7.6 表）统一只读 `public_url`。
