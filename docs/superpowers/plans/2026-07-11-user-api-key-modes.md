# User API Key Modes and Multi-Task Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 system 现有钱链路的前提下，通过统一 `/api/generate` 增加 user-scoped custom Key、任务级加密临时凭据、多任务批量状态追踪，以及 system/custom 共用的五分钟权威 deadline。

**Architecture:** 请求经严格鉴权后按 `credentialMode` 在同一 enqueue 内分流：system 保留余额/并发/预算与成功扣费，custom 跳过这些闸并原子写入 generation + AES-GCM 密文凭据。Background 只接收 `generationId`，按 mode 解析凭据后调用同一个 `callRelay`；成功分别进入计费或零扣费事务，状态读取和 cron 共用 deadline 收口 helper。

**Tech Stack:** React Router 8 framework mode、React 19、TanStack Query v5、Zod 4、Neon Postgres、Drizzle ORM、Netlify Functions/Background/Scheduled Functions、Node `crypto` AES-256-GCM、Vitest、Playwright。

---

## 实施前检查

- 先读 [批准版 PRD](../../../tasks/prd-user-api-key-modes.md)、[产品规格 §25](../../redesign-requirements.md) 和 [技术文档索引](../../dev/README.md)。冲突时以 PRD 为准，不重新提议第二个生图端点。
- 确认工作树只含本功能变更；不要覆盖用户已有改动。当前生产与本地文档记录为同一 Neon 库，迁移/钱测试优先切到 Neon 分支库；若只能连生产，先备份并在维护窗口执行 additive migration。
- 从 Task 1 顺序执行。每个 task 都先看到预期失败，再写实现，再跑指定回归，再单独提交。
- `CUSTOM_KEY_JOB_ENCRYPTION_KEY` 的测试值使用 `Buffer.alloc(32, 7).toString("base64")`；真实值只在部署 Task 11 生成，不写入仓库。

## 文件职责图

| 文件 | 单一职责 |
|---|---|
| `src/contracts/generate.ts` | mode-aware 提交、accepted、单项/批量状态和错误枚举 |
| `src/lib/userApiConfig.ts` | user-scoped 明文 localStorage 读写与变更事件 |
| `src/hooks/useUserApiConfig.ts` | 把当前 user 的本地配置接入 React |
| `src/server/generation/credential.server.ts` | AES-GCM 加解密、取凭据、终态/孤儿删除 |
| `src/server/generation/enqueue.ts` | 严格校验后的 system/custom 原子入队分流 |
| `src/server/relay.ts` | 同一 relay 构造/请求/解析；凭据来源和 deadline 显式注入 |
| `src/server/generation/finalizeCustom.server.ts` | custom 图片成功的幂等零扣费事务 |
| `src/server/generation/deadline.server.ts` | status/cron 共用的五分钟原子收口 |
| `src/server/generation/status.server.ts` | owner-scoped 单项/批量状态读取与映射 |
| `src/components/shell/ApiKeyModal.tsx` | system/custom 单选、Key 显隐/保存/清除、固定 URL |
| `src/hooks/useGenerationStatus.ts` | 当前会话全部非终态 generation 的单请求批量轮询 |
| `drizzle/0005_user_generation_credentials.sql` | mode/deadline/临时凭据表的向后兼容迁移 |

### Task 1: 锁定契约与 user-scoped 本地配置

**Files:**
- Create: `src/contracts/generate.test.ts`
- Create: `src/lib/userApiConfig.ts`
- Create: `src/lib/userApiConfig.test.ts`
- Modify: `src/contracts/generate.ts:5-94`
- Modify: `src/components/conversation/ConversationView.tsx:30-42,272-283`
- Modify: `src/phase1.test.tsx:7-21`

- [ ] **Step 1: 写失败的契约测试**

在 `src/contracts/generate.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import {
  GenerateAcceptedResponse,
  GenerateRequest,
  GenerateStatusBatchResponse,
} from "./generate";

const base = { prompt: "test", size: "1024x1024" };

describe("GenerateRequest credential mode", () => {
  it("accepts system without customApiKey", () => {
    expect(GenerateRequest.parse({ ...base, credentialMode: "system" }).credentialMode).toBe("system");
  });

  it("requires a nonblank custom key", () => {
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom" }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom", customApiKey: "   " }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom", customApiKey: "x".repeat(501) }).success).toBe(false);
  });

  it("forbids customApiKey in system mode", () => {
    expect(
      GenerateRequest.safeParse({ ...base, credentialMode: "system", customApiKey: "sk-must-not-travel" }).success,
    ).toBe(false);
  });

  it("accepts the unified accepted and batch status shapes", () => {
    const deadlineAt = "2026-07-11T12:05:00.000Z";
    expect(
      GenerateAcceptedResponse.parse({
        generationId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        status: "queued",
        credentialMode: "custom",
        deadlineAt,
      }).deadlineAt,
    ).toBe(deadlineAt);
    expect(
      GenerateStatusBatchResponse.parse({
        items: [
          {
            generationId: crypto.randomUUID(),
            credentialMode: "system",
            deadlineAt,
            status: "running",
          },
        ],
      }).items,
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:run -- src/contracts/generate.test.ts`

Expected: FAIL，提示 `GenerateStatusBatchResponse` 不存在，且旧 `GenerateRequest` 不识别 mode 规则。

- [ ] **Step 3: 拆分参数契约并加入 mode-aware schema**

在 `src/contracts/generate.ts` 保留现有尺寸/质量/背景定义，替换请求、错误码和状态响应区为：

```ts
export const CredentialModeSchema = z.enum(["system", "custom"]);
export type CredentialMode = z.infer<typeof CredentialModeSchema>;

export const ACTIVE_ERROR_CODES = [
  "custom_key_invalid",
  "custom_key_quota",
  "relay_rate_limited",
  "provider_timeout",
  "relay_unreachable",
  "invalid_request",
  "content_rejected",
  "invalid_response",
  "storage_failed",
  "unknown",
] as const;
export const LEGACY_ERROR_CODES = ["insufficient_quota", "relay_5xx"] as const;
export const ERROR_CODES = [...ACTIVE_ERROR_CODES, ...LEGACY_ERROR_CODES] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const GenerateParams = z.object({
  prompt: z.string().min(1, "prompt 不能为空").max(4000),
  size: z.enum(SIZES),
  quality: z.enum(QUALITIES).optional(),
  background: z.enum(BACKGROUNDS).optional(),
});
export type GenerateParams = z.infer<typeof GenerateParams>;

export const GenerateRequest = GenerateParams.extend({
  conversationId: z.uuid().optional(),
  generationId: z.uuid().optional(),
  inputImageKey: z.string().min(1).max(300).optional(),
  credentialMode: CredentialModeSchema,
  customApiKey: z.string().min(1).max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.credentialMode === "custom" && !value.customApiKey?.trim()) {
    ctx.addIssue({ code: "custom", path: ["customApiKey"], message: "CUSTOM_KEY_REQUIRED" });
  }
  if (value.credentialMode === "system" && value.customApiKey !== undefined) {
    ctx.addIssue({ code: "custom", path: ["customApiKey"], message: "SYSTEM_MODE_FORBIDS_CUSTOM_KEY" });
  }
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

const statusIdentity = {
  generationId: z.uuid(),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.string(),
};

export const GenerateStatusResponse = z.discriminatedUnion("status", [
  z.object({
    ...statusIdentity,
    status: z.enum(["queued", "claimed", "running"]),
    startedAt: z.string().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("succeeded"),
    image: z.object({
      publicUrl: z.url(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
    creditsChargedMp: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("failed"),
    errorCode: z.enum(ERROR_CODES),
    error: z.string(),
    httpStatus: z.number().int().nullable(),
    creditsChargedMp: z.literal(0),
  }),
]);
export type GenerateStatusResponse = z.infer<typeof GenerateStatusResponse>;

export const GenerateStatusBatchResponse = z.object({ items: z.array(GenerateStatusResponse).max(50) });
export type GenerateStatusBatchResponse = z.infer<typeof GenerateStatusBatchResponse>;

export const GenerateAcceptedResponse = z.object({
  generationId: z.uuid(),
  conversationId: z.uuid(),
  status: z.literal("queued"),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.string(),
});
export type GenerateAccepted = z.infer<typeof GenerateAcceptedResponse>;
```

旧错误码只用于读取历史 generation；Task 5 后的新失败写入只能使用 `ACTIVE_ERROR_CODES`。

为保证本 task 的提交仍可编译，把 `ConversationView.tsx` 的 `EMPTY_REQUEST` 和旧 regenerate 请求先显式设为 system：

```ts
const EMPTY_REQUEST: GenerateRequest = {
  prompt: "",
  size: "auto",
  quality: "auto",
  background: "auto",
  credentialMode: "system",
};

runGeneration({
  prompt: turn.prompt,
  size: turn.size as Size,
  quality: (turn.quality as Quality | null) ?? "auto",
  background: (turn.background as Background | null) ?? "auto",
  credentialMode: "system",
});
```

Task 9 会把 Composer 参数与凭据配置拆开，并从当前用户选择动态提供 mode；此处只维持迁移期间的 system 行为。

在 `src/phase1.test.tsx` 的 `baseReq` 增加 `credentialMode: "system"`，让现有 Composer 测试继续使用合法的迁移期请求。

- [ ] **Step 4: 写失败的 localStorage 测试**

在 `src/lib/userApiConfig.test.ts` 写入：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_RELAY_BASE_URL,
  clearUserApiConfig,
  loadUserApiConfig,
  saveUserApiConfig,
} from "./userApiConfig";

describe("userApiConfig", () => {
  beforeEach(() => localStorage.clear());

  it("defaults each unknown user to system", () => {
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
    expect(CUSTOM_RELAY_BASE_URL).toBe("https://api.tangguo.xin/v1");
  });

  it("stores plaintext per user and keeps accounts isolated", () => {
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a-plain" });
    saveUserApiConfig("user-b", { mode: "system", customApiKey: "sk-b-retained" });
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", customApiKey: "sk-a-plain" });
    expect(loadUserApiConfig("user-b")).toEqual({ mode: "system", customApiKey: "sk-b-retained" });
  });

  it("recovers from invalid JSON and clear returns to system", () => {
    localStorage.setItem("image-workshop:api-config:v1:user-a", "not-json");
    expect(loadUserApiConfig("user-a").mode).toBe("system");
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a" });
    clearUserApiConfig("user-a");
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
  });

  it("notifies same-tab subscribers", () => {
    const listener = vi.fn();
    window.addEventListener("user-api-config-changed", listener);
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a" });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("user-api-config-changed", listener);
  });
});
```

- [ ] **Step 5: 运行 localStorage 测试并确认失败**

Run: `npm run test:run -- src/lib/userApiConfig.test.ts`

Expected: FAIL，提示 `userApiConfig` 模块不存在。

- [ ] **Step 6: 实现纯客户端本地配置 helper**

创建 `src/lib/userApiConfig.ts`：

```ts
import type { CredentialMode } from "../contracts/generate";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";
export const USER_API_CONFIG_EVENT = "user-api-config-changed";
export const MAX_CUSTOM_API_KEY_LENGTH = 500;

export interface UserApiConfig {
  mode: CredentialMode;
  customApiKey: string;
}

const fallback = (): UserApiConfig => ({ mode: "system", customApiKey: "" });
export const userApiConfigStorageKey = (userId: string) => `image-workshop:api-config:v1:${userId}`;

export function loadUserApiConfig(userId: string): UserApiConfig {
  if (typeof window === "undefined") return fallback();
  try {
    const parsed = JSON.parse(localStorage.getItem(userApiConfigStorageKey(userId)) ?? "null") as Partial<UserApiConfig> | null;
    if (!parsed || (parsed.mode !== "system" && parsed.mode !== "custom")) return fallback();
    return {
      mode: parsed.mode,
      customApiKey: typeof parsed.customApiKey === "string" ? parsed.customApiKey : "",
    };
  } catch {
    return fallback();
  }
}

export function saveUserApiConfig(userId: string, value: UserApiConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(userApiConfigStorageKey(userId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(USER_API_CONFIG_EVENT, { detail: { userId } }));
}

export function clearUserApiConfig(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(userApiConfigStorageKey(userId));
  window.dispatchEvent(new CustomEvent(USER_API_CONFIG_EVENT, { detail: { userId } }));
}
```

- [ ] **Step 7: 运行契约与本地配置测试**

Run: `npm run test:run -- src/contracts/generate.test.ts src/lib/userApiConfig.test.ts`

Expected: 2 test files PASS，所有 mode/key/batch/user-isolation 断言通过。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add src/contracts/generate.ts src/contracts/generate.test.ts src/lib/userApiConfig.ts src/lib/userApiConfig.test.ts src/components/conversation/ConversationView.tsx src/phase1.test.tsx
git commit -m "feat: define user credential mode contracts"
```

### Task 2: 增加 mode、deadline 和临时凭据 schema

**Files:**
- Create: `drizzle/0005_user_generation_credentials.sql`
- Create: `scripts/migrate-user-generation-credentials.ts`
- Create: `tests/money/key-mode-schema.test.ts`
- Modify: `src/db/schema.ts:193-234`
- Modify: `tests/money/_helpers.ts:31-168`

- [ ] **Step 1: 写失败的真库 schema 测试**

创建 `tests/money/key-mode-schema.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestCtx, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("key mode schema", () => {
  it("defaults generations to system and creates a five minute deadline", async () => {
    const uid = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(uid);
    const g = await ctx.gen(generationId);
    expect(g?.credential_mode).toBe("system");
    expect(Date.parse(String(g?.deadline_at)) - Date.parse(String(g?.created_at))).toBe(300_000);
  });

  it("stores only encrypted credential material and cascades on generation delete", async () => {
    const uid = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(uid, { credentialMode: "custom" });
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${generationId},'cipher-b64','iv-b64','tag-b64',1,now()+interval '15 minutes')`;
    expect((await ctx.credentials(generationId)).length).toBe(1);
    await ctx.sql`DELETE FROM generations WHERE id=${generationId}`;
    expect((await ctx.credentials(generationId)).length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认 schema 尚不存在**

Run: `npm run test:money -- tests/money/key-mode-schema.test.ts`

Expected: FAIL，数据库报告 `credential_mode`、`deadline_at` 或 `generation_credentials` 不存在。

- [ ] **Step 3: 编写 additive migration**

创建 `drizzle/0005_user_generation_credentials.sql`：

```sql
ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS credential_mode text NOT NULL DEFAULT 'system';

DO $$ BEGIN
  ALTER TABLE generations ADD CONSTRAINT generations_credential_mode_chk
    CHECK (credential_mode IN ('system','custom'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE generations ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

UPDATE generations
SET deadline_at = CASE
  WHEN status IN ('queued','claimed','running') THEN now() + interval '5 minutes'
  ELSE created_at + interval '5 minutes'
END
WHERE deadline_at IS NULL;

ALTER TABLE generations ALTER COLUMN deadline_at SET DEFAULT (now() + interval '5 minutes');
ALTER TABLE generations ALTER COLUMN deadline_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS generation_credentials (
  generation_id uuid PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gen_inflight_deadline
  ON generations(deadline_at)
  WHERE status IN ('queued','claimed','running');

CREATE INDEX IF NOT EXISTS ix_generation_credentials_expires
  ON generation_credentials(expires_at);
```

- [ ] **Step 4: 更新 Drizzle schema**

在 `src/db/schema.ts` 的 `generations` 字段中加入：

```ts
credentialMode: text("credential_mode").notNull().default("system"),
deadlineAt: timestamp("deadline_at", tz).notNull().default(sql`now() + interval '5 minutes'`),
```

在其约束数组加入：

```ts
check("generations_credential_mode_chk", sql`${t.credentialMode} IN ('system','custom')`),
index("ix_gen_inflight_deadline")
  .on(t.deadlineAt)
  .where(sql`${t.status} IN ('queued','claimed','running')`),
```

在 `generations` 后、`images` 前新增：

```ts
export const generationCredentials = pgTable(
  "generation_credentials",
  {
    generationId: uuid("generation_id")
      .primaryKey()
      .references(() => generations.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("ix_generation_credentials_expires").on(t.expiresAt)],
);
```

- [ ] **Step 5: 增加幂等迁移脚本并应用到测试库**

创建 `scripts/migrate-user-generation-credentials.ts`：

```ts
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/db.server";

const ddl = readFileSync(new URL("../drizzle/0005_user_generation_credentials.sql", import.meta.url), "utf8");
const pool = getPool();
const client = await pool.connect();
try {
  await client.query(ddl);
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM information_schema.columns
        WHERE table_name='generations' AND column_name IN ('credential_mode','deadline_at')) AS generation_columns,
       (SELECT count(*) FROM information_schema.tables
        WHERE table_name='generation_credentials') AS credential_tables`,
  );
  console.log(
    `[migrate] 0005 applied. generation columns=${result.rows[0].generation_columns}/2 credential table=${result.rows[0].credential_tables}/1`,
  );
} finally {
  client.release();
  await pool.end();
}
process.exit(0);
```

Run: `node --env-file=.env --import tsx scripts/migrate-user-generation-credentials.ts`

Expected: `[migrate] 0005 applied. generation columns=2/2 credential table=1/1`。

- [ ] **Step 6: 扩展 money 测试 helper**

把 `TestCtx.createGeneration` 的 options 改为：

```ts
createGeneration(
  userId: string,
  opts?: {
    status?: string;
    startedAtAgoSec?: number;
    credentialMode?: "system" | "custom";
    deadlineAgoSec?: number;
  },
): Promise<{ conversationId: string; generationId: string }>;
credentials(generationId: string): Promise<Array<Record<string, unknown>>>;
```

插入 generation 时显式写 `credential_mode` 与 `deadline_at`：

```ts
const mode = opts.credentialMode ?? "system";
const deadlineAgo = opts.deadlineAgoSec;
const deadlineExpr = deadlineAgo === undefined ? "5 minutes" : `${-deadlineAgo} seconds`;
await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,credential_mode,deadline_at,started_at)
          VALUES(${genId},${convId},${userId},'mtest prompt','auto',${status},${mode},
                 now()+(${deadlineExpr}::interval),
                 CASE WHEN ${status} IN ('claimed','running')
                      THEN now()-(${opts.startedAtAgoSec ?? 0}::int*interval '1 second') ELSE NULL END)`;
```

实现查询：

```ts
async credentials(generationId) {
  return (await sql`SELECT * FROM generation_credentials WHERE generation_id=${generationId}`) as Array<Record<string, unknown>>;
},
```

`cleanup()` 无需单独删凭据，`users → conversations → generations` 级联会删除。

- [ ] **Step 7: 运行 schema 测试与类型检查**

Run: `npm run test:money -- tests/money/key-mode-schema.test.ts`

Expected: PASS，2 个 schema 用例通过。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add drizzle/0005_user_generation_credentials.sql scripts/migrate-user-generation-credentials.ts src/db/schema.ts tests/money/_helpers.ts tests/money/key-mode-schema.test.ts
git commit -m "feat: add generation credential mode schema"
```

### Task 3: 实现 AES-GCM 任务级临时凭据

**Files:**
- Create: `src/server/generation/credential.server.ts`
- Create: `src/server/generation/credential.server.test.ts`

- [ ] **Step 1: 写失败的加密生命周期测试**

创建 `src/server/generation/credential.server.test.ts`：

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialConfigurationError,
  decryptCustomApiKey,
  encryptCustomApiKey,
} from "./credential.server";

const original = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = original;
});

describe("custom credential AES-GCM", () => {
  it("round trips without placing plaintext in stored fields", () => {
    const plaintext = "sk-sentinel-7bc90a5d";
    const encrypted = encryptCustomApiKey(plaintext, new Date("2026-07-11T12:00:00Z"));
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.expiresAt.toISOString()).toBe("2026-07-11T12:15:00.000Z");
    expect(decryptCustomApiKey(encrypted)).toBe(plaintext);
  });

  it("uses a random 96-bit IV", () => {
    const first = encryptCustomApiKey("sk-same");
    const second = encryptCustomApiKey("sk-same");
    expect(first.iv).not.toBe(second.iv);
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
  });

  it("fails closed with a fixed message for an invalid master key", () => {
    process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = "short";
    expect(() => encryptCustomApiKey("sk-value")).toThrow(CredentialConfigurationError);
    expect(() => encryptCustomApiKey("sk-value")).toThrow("custom credential encryption is unavailable");
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `npm run test:run -- src/server/generation/credential.server.test.ts`

Expected: FAIL，提示无法导入 `credential.server`。

- [ ] **Step 3: 实现加解密和 DB 生命周期函数**

创建 `src/server/generation/credential.server.ts`：

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSql } from "../../db/db.server";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";
export const CUSTOM_CREDENTIAL_KEY_VERSION = 1;
const CREDENTIAL_TTL_MS = 15 * 60_000;

export class CredentialConfigurationError extends Error {
  constructor() {
    super("custom credential encryption is unavailable");
    this.name = "CredentialConfigurationError";
  }
}

export interface EncryptedCustomApiKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  expiresAt: Date;
}

function masterKey(): Buffer {
  const raw = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new CredentialConfigurationError();
  return key;
}

export function encryptCustomApiKey(apiKey: string, now = new Date()): EncryptedCustomApiKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CUSTOM_CREDENTIAL_KEY_VERSION,
    expiresAt: new Date(now.getTime() + CREDENTIAL_TTL_MS),
  };
}

export function decryptCustomApiKey(value: EncryptedCustomApiKey): string {
  if (value.keyVersion !== CUSTOM_CREDENTIAL_KEY_VERSION) throw new CredentialConfigurationError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CredentialConfigurationError();
  }
}

export async function loadCustomApiKey(generationId: string): Promise<string> {
  const rows = await getSql()`SELECT ciphertext,iv,auth_tag,key_version,expires_at
                              FROM generation_credentials WHERE generation_id=${generationId}`;
  const row = rows[0];
  if (!row || new Date(row.expires_at as string).getTime() <= Date.now()) {
    throw new CredentialConfigurationError();
  }
  return decryptCustomApiKey({
    ciphertext: row.ciphertext as string,
    iv: row.iv as string,
    authTag: row.auth_tag as string,
    keyVersion: Number(row.key_version),
    expiresAt: new Date(row.expires_at as string),
  });
}

export async function deleteGenerationCredential(generationId: string): Promise<void> {
  await getSql()`DELETE FROM generation_credentials WHERE generation_id=${generationId}`;
}

export async function deleteExpiredGenerationCredentials(now = new Date()): Promise<number> {
  const rows = await getSql()`DELETE FROM generation_credentials WHERE expires_at<=${now.toISOString()} RETURNING generation_id`;
  return rows.length;
}
```

- [ ] **Step 4: 运行单测和 secrets 静态断言回归**

Run: `npm run test:run -- src/server/generation/credential.server.test.ts`

Expected: PASS，3 个 AES-GCM 用例通过。

Run: `npm run build && npm run assert-no-secrets`

Expected: build exit 0，`assert-no-secrets` PASS；测试 plaintext 和 env 主密钥值均不在 `build/client`。

- [ ] **Step 5: 提交**

```bash
git add src/server/generation/credential.server.ts src/server/generation/credential.server.test.ts
git commit -m "feat: encrypt generation scoped custom credentials"
```

### Task 4: 在统一 `/api/generate` 中实现 mode-aware 原子入队

**Files:**
- Create: `tests/money/enqueue-custom.test.ts`
- Modify: `src/server/generation/enqueue.ts:17-112`
- Modify: `netlify/functions/generate.ts:1-32`

- [ ] **Step 1: 写 custom 绕过闸门但仍隔离资源的失败测试**

创建 `tests/money/enqueue-custom.test.ts`：

```ts
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey } from "../../src/server/budget.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;
  await ctx.cleanup();
});

describe("custom enqueue", () => {
  it("queues three jobs with zero balance while system budget and concurrency are full", async () => {
    const uid = await ctx.createUser({ balanceMp: 0, maxConcurrency: 1 });
    await ctx.createGeneration(uid, { status: "running", credentialMode: "system" });
    await ctx.sql`INSERT INTO app_config(key,value_json)
                  VALUES(${budgetTodayKey()},'{"calls":99999999,"ms":0}'::jsonb)
                  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;

    const results = await Promise.all(
      ["one", "two", "three"].map((prompt) =>
        enqueueGeneration({
          user: { id: uid, maxConcurrency: 1 },
          input: {
            prompt,
            size: "auto",
            credentialMode: "custom",
            customApiKey: "sk-custom-plain-sentinel",
          },
        }),
      ),
    );

    expect(results).toHaveLength(3);
    const rows = await ctx.sql`SELECT credential_mode,credits_charged_mp,deadline_at-created_at AS ttl
                               FROM generations WHERE id=ANY(${results.map((r) => r.generationId)}::uuid[])`;
    expect(rows.every((row) => row.credential_mode === "custom" && Number(row.credits_charged_mp) === 0)).toBe(true);
    expect((await ctx.sql`SELECT count(*)::int AS n FROM generation_credentials
                          WHERE generation_id=ANY(${results.map((r) => r.generationId)}::uuid[])`)[0].n).toBe(3);
    expect(JSON.stringify(await ctx.sql`SELECT * FROM generation_credentials
                                        WHERE generation_id=ANY(${results.map((r) => r.generationId)}::uuid[])`)).not.toContain(
      "sk-custom-plain-sentinel",
    );
  });

  it("keeps owner checks and rejects malformed internal mode usage", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const foreignKey = `uploads/${randomUUID()}/ref.png`;
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: {
          prompt: "edit",
          size: "auto",
          inputImageKey: foreignKey,
          credentialMode: "custom",
          customApiKey: "sk-custom",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: { prompt: "bad", size: "auto", credentialMode: "system", customApiKey: "sk-forbidden" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails closed before creating a generation when encryption is unavailable", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: { prompt: "p", size: "auto", credentialMode: "custom", customApiKey: "sk-value" },
      }),
    ).rejects.toThrow("custom credential encryption is unavailable");
    expect(await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认 custom 仍被旧三闸拒绝**

Run: `npm run test:money -- tests/money/enqueue-custom.test.ts`

Expected: FAIL；旧 `EnqueueRequest` 无 mode 字段，或零余额 custom 返回 402。

- [ ] **Step 3: 扩展 enqueue 类型并在事务外加密**

在 `src/server/generation/enqueue.ts` 增加 imports：

```ts
import type { CredentialMode } from "../../contracts/generate";
import { encryptCustomApiKey, type EncryptedCustomApiKey } from "./credential.server";
```

扩展类型：

```ts
export interface EnqueueRequest {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  conversationId?: string;
  generationId?: string;
  inputImageKey?: string | null;
  credentialMode: CredentialMode;
  customApiKey?: string;
}

export interface EnqueueResult {
  generationId: string;
  conversationId: string;
  credentialMode: CredentialMode;
  deadlineAt: string;
}

type PersistableEnqueueRequest = Omit<EnqueueRequest, "customApiKey">;
```

把现有 account lock、并发、余额和预算代码包在：

```ts
if (input.credentialMode === "system") {
  const acct = await c.query("SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE", [user.id]);
  if (acct.rowCount === 0) throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  const inflight = await c.query(
    "SELECT COUNT(*)::int AS n FROM generations WHERE user_id=$1 AND status IN ('queued','claimed','running')",
    [user.id],
  );
  const current = Number(inflight.rows[0].n);
  if (current >= user.maxConcurrency) {
    throw httpError(409, "CONCURRENCY_LIMIT", "超出并发数量", { limit: user.maxConcurrency, current });
  }
  const priceMp = await readConfigInt(c, "price_per_image_mp", 70);
  const balance = await c.query(
    `SELECT COALESCE(SUM(remaining_mp),0)::bigint AS s FROM credit_lots
     WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`,
    [user.id],
  );
  if (Number(balance.rows[0].s) < priceMp) {
    throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  }
  if (await isDailyBudgetExhausted(c)) {
    throw httpError(429, "BUDGET_EXHAUSTED", "今日额度已满，请稍后");
  }
}
```

修改 `run` 签名，让 input 使用 `PersistableEnqueueRequest` 并额外接收 `encrypted: EncryptedCustomApiKey | null`；把两条 generation INSERT 都改为显式写 mode/deadline、返回 deadline：

```sql
INSERT INTO generations(
  id,conversation_id,user_id,prompt,model,size,quality,background,moderation,input_image_key,
  credential_mode,deadline_at,status
)
VALUES($1,$2,$3,$4,'gpt-image-2',$5,$6,$7,'low',$8,$9,now()+interval '5 minutes','queued')
RETURNING id,deadline_at
```

没有客户端 `generationId` 的分支使用同一字段顺序但移除 `id` 与第一个参数。generation 插入后，在返回 202 前执行：

```ts
if (input.credentialMode === "custom") {
  if (!encrypted) throw httpError(500, "INTERNAL", "自定义 Key 暂时不可用");
  await c.query(
    `INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [gen.rows[0].id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion, encrypted.expiresAt],
  );
}
return {
  generationId: gen.rows[0].id as string,
  conversationId,
  credentialMode: input.credentialMode,
  deadlineAt: new Date(gen.rows[0].deadline_at as string).toISOString(),
};
```

导出函数负责固定错误和明文最短生命周期：

```ts
export async function enqueueGeneration(args: { user: EnqueueUser; input: EnqueueRequest }): Promise<EnqueueResult> {
  const { input } = args;
  if (input.credentialMode === "custom" && !input.customApiKey?.trim()) {
    throw httpError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key");
  }
  if (input.credentialMode === "system" && input.customApiKey !== undefined) {
    throw httpError(400, "INVALID_PARAM", "系统 Key 模式不接受自定义 Key");
  }
  const { customApiKey, ...persistableInput } = input;
  const encrypted = input.credentialMode === "custom" ? encryptCustomApiKey(customApiKey as string) : null;
  return tx((client) => run(client, args.user, persistableInput, encrypted));
}
```

- [ ] **Step 4: 更新统一 generate handler 的解析与 202 响应**

把 `netlify/functions/generate.ts` 的解析改为 `safeParse`，避免把 Key 放进错误：

```ts
const parsed = GenerateRequest.safeParse(await req.json());
if (!parsed.success) {
  const missingCustomKey = parsed.error.issues.some((issue) => issue.message === "CUSTOM_KEY_REQUIRED");
  return missingCustomKey
    ? httpError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key")
    : httpError(400, "INVALID_PARAM", "参数无效");
}
const accepted = await enqueueGeneration({
  user: { id: ctx.userId, maxConcurrency: ctx.maxConcurrency },
  input: parsed.data,
});
await triggerBackground(accepted.generationId);
return Response.json({ ...accepted, status: "queued" }, { status: 202 });
```

handler 的 catch 继续只写固定 `[generate] error`；在 Task 10 将 logger/Sentry sanitizer 覆盖请求错误对象。

- [ ] **Step 5: 跑 custom 与 system enqueue 回归**

Run: `npm run test:money -- tests/money/enqueue-custom.test.ts tests/money/enqueue.test.ts`

Expected: PASS；custom 2 用例和既有 system 三闸/owner-scope 用例全部通过。

Run: `npm run typecheck`

Expected: exit 0；Task 1 的迁移期前端请求已显式使用 system mode，server/schema 也无类型错误。

- [ ] **Step 6: 提交**

```bash
git add src/server/generation/enqueue.ts netlify/functions/generate.ts tests/money/enqueue-custom.test.ts
git commit -m "feat: enqueue custom key generations"
```

### Task 5: 让同一个 relay 支持显式凭据和 deadline

**Files:**
- Create: `src/server/relay.test.ts`
- Create: `src/server/generation/failure.test.ts`
- Modify: `src/server/relay.ts:1-185`
- Modify: `src/server/generation/failure.ts:1-39`
- Modify: `src/lib/redaction.ts:1-39`
- Modify: `src/lib/redaction.test.ts:1-36`

- [ ] **Step 1: 写 custom 固定 URL、剩余 deadline 和错误映射测试**

在 `src/server/relay.test.ts` 写入：

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { callRelay, relayTimeoutMs } from "./relay";

afterEach(() => vi.unstubAllGlobals());

describe("custom relay target", () => {
  it("uses the fixed base, custom bearer, and remaining deadline", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "p",
      size: "1024x1024",
      credential: { mode: "custom", apiKey: "sk-custom-sentinel" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/generations");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-custom-sentinel",
    );
    expect(relayTimeoutMs(Date.now() + 90_000, Date.now())).toBeGreaterThanOrEqual(59_900);
    expect(relayTimeoutMs(Date.now() + 20_000, Date.now())).toBe(0);
  });

  it("uses the same custom target for image edits", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "edit",
      size: "1024x1024",
      inputImage: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" },
      credential: { mode: "custom", apiKey: "sk-custom-sentinel" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/edits");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });
});
```

在 `src/server/generation/failure.test.ts` 写入：

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeFailure } from "./failure";

const error = (message: string, httpStatus?: number) => Object.assign(new Error(message), { httpStatus });

describe("mode-aware failure mapping", () => {
  it.each([
    [error("bad credentials", 401), "custom_key_invalid"],
    [error("insufficient_quota", 402), "custom_key_quota"],
    [error("too many requests", 429), "relay_rate_limited"],
    [error("content_policy", 403), "content_rejected"],
    [error("invalid size", 400), "invalid_request"],
    [error("gateway unavailable", 503), "relay_unreachable"],
  ])("maps custom provider errors", (err, code) => {
    expect(normalizeFailure(err, { mode: "custom", secrets: ["sk-secret"] }).code).toBe(code);
  });

  it("redacts the actual custom key before returning a message", () => {
    const result = normalizeFailure(error("echo sk-secret", 401), {
      mode: "custom",
      secrets: ["sk-secret"],
    });
    expect(result.message).not.toContain("sk-secret");
  });
});
```

- [ ] **Step 2: 运行测试并确认旧 relay 只能读取 system 配置**

Run: `npm run test:run -- src/server/relay.test.ts src/server/generation/failure.test.ts`

Expected: FAIL，旧 `callRelay` 不接受 `credential/deadlineAt`，旧错误枚举也无 custom codes。

- [ ] **Step 3: 重构 relay target，不复制请求构造**

在 `src/server/relay.ts` 定义：

```ts
import type { CredentialMode } from "../contracts/generate";
import { CUSTOM_RELAY_BASE_URL } from "./generation/credential.server";

export type RelayCredential =
  | { mode: "system" }
  | { mode: "custom"; apiKey: string };

export function relayTimeoutMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs - 30_000);
}

async function relayTarget(credential: RelayCredential): Promise<{ mode: CredentialMode; key: string; bases: string[] }> {
  if (credential.mode === "custom") {
    return { mode: "custom", key: credential.apiKey, bases: [CUSTOM_RELAY_BASE_URL] };
  }
  return { mode: "system", key: await relayKey(), bases: await relayBases() };
}
```

把 `callRelay` 参数扩展为：

```ts
export interface CallRelayRequest {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImage?: RelayInputImage | null;
  credential: RelayCredential;
  deadlineAt: Date;
}
```

函数开头改为：

```ts
export async function callRelay(req: CallRelayRequest): Promise<{ images: RelayImage[]; raw: unknown }> {
  const { key, bases } = await relayTarget(req.credential);
  const timeoutMs = relayTimeoutMs(req.deadlineAt.getTime());
  if (timeoutMs <= 0) throw new DOMException("provider deadline exceeded", "AbortError");
  const isEdit = Boolean(req.inputImage);
  const endpoint = isEdit ? "/images/edits" : undefined;
```

把每次循环的 timer 从固定 `RELAY_SOFT_TIMEOUT_MS` 改为：

```ts
const remainingMs = relayTimeoutMs(req.deadlineAt.getTime());
if (remainingMs <= 0) throw new DOMException("provider deadline exceeded", "AbortError");
const timer = setTimeout(() => ctrl.abort(), remainingMs);
```

保留现有 t2i JSON、i2i FormData、response_format、解析与 system backup 循环原样；custom 的 `bases` 只有固定 URL，因此永不尝试 system/backup Base。

- [ ] **Step 4: 实现 mode-aware failure mapping**

在 `src/server/generation/failure.ts` 把签名与分类替换为：

```ts
import type { CredentialMode, ErrorCode } from "../../contracts/generate";
import { redactText } from "../../lib/redaction";

type RelayErrorLike = { name?: string; httpStatus?: number; message?: string; failureCode?: ErrorCode };

export function normalizeFailure(
  err: unknown,
  context: { mode: CredentialMode; secrets: string[] },
): { code: ErrorCode; message: string; httpStatus?: number } {
  const value = (err ?? {}) as RelayErrorLike;
  const status = value.httpStatus;
  const raw = redactText(String(value.message ?? ""), context.secrets);
  if (value.failureCode) return { code: value.failureCode, message: raw.slice(0, 500), httpStatus: status };
  if (value.name === "AbortError" || status === 504 || /timeout|timed out|deadline/i.test(raw)) {
    return { code: "provider_timeout", message: "请求超时，本次未扣积分，请重试", httpStatus: status };
  }
  if (/moderation|safety|content_policy|rejected/i.test(raw) || (status === 403 && /content|policy/i.test(raw))) {
    return { code: "content_rejected", message: raw.slice(0, 500), httpStatus: status };
  }
  if (context.mode === "custom" && (status === 401 || status === 403)) {
    return { code: "custom_key_invalid", message: raw.slice(0, 500), httpStatus: status };
  }
  if (context.mode === "custom" && (/insufficient_quota|quota|billing|欠费/i.test(raw) || status === 402)) {
    return { code: "custom_key_quota", message: raw.slice(0, 500), httpStatus: status };
  }
  if (status === 429) return { code: "relay_rate_limited", message: raw.slice(0, 500), httpStatus: status };
  if (status === 400 || /invalid|must use|unsupported|dimension|format/i.test(raw)) {
    return { code: "invalid_request", message: raw.slice(0, 500), httpStatus: status };
  }
  if (value.name === "TypeError" || /fetch failed|ECONN|network/i.test(raw) || (status !== undefined && status >= 500)) {
    return { code: "relay_unreachable", message: raw.slice(0, 500), httpStatus: status };
  }
  return { code: "unknown", message: raw.slice(0, 500), httpStatus: status };
}
```

`storage_failed` 与 `invalid_response` 由 Task 6 在调用阶段通过 `failureCode` 显式标记。

- [ ] **Step 5: 扩大通用 bearer 脱敏但不改变返回形态**

在 `src/lib/redaction.ts` 把 patterns 改为：

```ts
const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b(api[_-]?key|token)\s*[:=]\s*[A-Za-z0-9._~+\/-]{8,}/gi,
];
```

在 `src/lib/redaction.test.ts` 增加非 `sk-` 自定义 Key 和 header/body 回显测试，断言原对象不变、输出不含 sentinel。

- [ ] **Step 6: 跑 relay、failure、redaction 测试**

Run: `npm run test:run -- src/server/relay.test.ts src/server/generation/failure.test.ts src/lib/redaction.test.ts`

Expected: PASS；固定 URL、剩余 deadline、错误码和高熵 Key 脱敏全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/server/relay.ts src/server/relay.test.ts src/server/generation/failure.ts src/server/generation/failure.test.ts src/lib/redaction.ts src/lib/redaction.test.ts
git commit -m "feat: route generation credentials through one relay"
```

### Task 6: 实现 custom 零扣费成功事务和 Background 分流

**Files:**
- Create: `src/server/generation/finalizeCustom.server.ts`
- Create: `tests/money/pipeline-custom.test.ts`
- Modify: `src/server/money/preempt.server.ts:10-52`
- Modify: `src/server/generation/process.ts:15-117`
- Modify: `tests/money/pipeline.test.ts:1-191`

- [ ] **Step 1: 写 custom 成功、失败、重入和不回退测试**

创建 `tests/money/pipeline-custom.test.ts`，复用 `pipeline.test.ts` 的 1px PNG/put 桩，并加入：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PutResult } from "../../src/server/r2.server";
import { encryptCustomApiKey } from "../../src/server/generation/credential.server";
import { runGenerationJob, type ProcessDeps } from "../../src/server/generation/process";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
const apiKey = "sk-custom-runtime-sentinel";
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

async function createCustom(uid: string): Promise<string> {
  const { generationId } = await ctx.createGeneration(uid, { credentialMode: "custom" });
  const sealed = encryptCustomApiKey(apiKey);
  await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                VALUES(${generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},${sealed.keyVersion},${sealed.expiresAt.toISOString()})`;
  return generationId;
}

const storage = async (_uid: string, gid: string): Promise<PutResult> => ({
  storageKey: `mtest/${gid}.png`,
  publicUrl: `https://img.test/${gid}.png`,
  contentType: "image/png",
  width: 1,
  height: 1,
  sizeBytes: 70,
});

describe("custom pipeline", () => {
  it("succeeds with zero charge and deletes the credential", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const callRelay = vi.fn(async (request) => {
      expect(request.credential).toEqual({ mode: "custom", apiKey });
      return { images: [{ b64_json: "aGVsbG8=" }], raw: {} };
    });
    expect(await runGenerationJob(gid, { callRelay, putToR2: storage })).toBe("succeeded");
    expect(Number((await ctx.gen(gid))?.credits_charged_mp)).toBe(0);
    expect(await ctx.balanceMp(uid)).toBe(0);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect(await ctx.images(gid)).toHaveLength(1);
    expect(await ctx.credentials(gid)).toHaveLength(0);
    expect(await runGenerationJob(gid, { callRelay, putToR2: storage })).toBe("lost");
    expect(callRelay).toHaveBeenCalledOnce();
  });

  it("never falls back to system when the custom key fails", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const callRelay: ProcessDeps["callRelay"] = async (request) => {
      expect(request.credential.mode).toBe("custom");
      throw Object.assign(new Error(`401 echoed ${apiKey}`), { httpStatus: 401 });
    };
    expect(await runGenerationJob(gid, { callRelay })).toBe("failed");
    const generation = await ctx.gen(gid);
    expect(generation?.error_code).toBe("custom_key_invalid");
    expect(String(generation?.error)).not.toContain(apiKey);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect(await ctx.credentials(gid)).toHaveLength(0);
  });

  it("runs custom image-to-image through the shared relay and still charges zero", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const inputImageKey = `uploads/${uid}/ref.png`;
    await ctx.sql`UPDATE generations SET input_image_key=${inputImageKey} WHERE id=${gid}`;
    let observedInput = false;
    const outcome = await runGenerationJob(gid, {
      getUploadObject: async (key) => {
        expect(key).toBe(inputImageKey);
        return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" };
      },
      callRelay: async (request) => {
        observedInput = Boolean(request.inputImage);
        expect(request.credential).toEqual({ mode: "custom", apiKey });
        return { images: [{ b64_json: "aGVsbG8=" }], raw: {} };
      },
      putToR2: storage,
    });
    expect(outcome).toBe("succeeded");
    expect(observedInput).toBe(true);
    expect(await ctx.balanceMp(uid)).toBe(0);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认 process 仍强制 system budget/debit**

Run: `npm run test:money -- tests/money/pipeline-custom.test.ts`

Expected: FAIL；claim 未返回 mode/deadline，process 未解密凭据且仍调用 `chargeOnSuccess`。

- [ ] **Step 3: 扩展 claim 返回 mode/deadline**

在 `src/server/money/preempt.server.ts` 的 `ClaimedGeneration` 增加：

```ts
credentialMode: "system" | "custom";
deadlineAt: Date;
```

claim SQL 增加 `credential_mode,deadline_at`，并把 WHERE 改成：

```sql
WHERE id=${generationId} AND status='queued' AND deadline_at>now()
RETURNING id,user_id,prompt,size,quality,background,input_image_key,credential_mode,deadline_at
```

映射新增：

```ts
credentialMode: r.credential_mode as "system" | "custom",
deadlineAt: new Date(r.deadline_at as string),
```

- [ ] **Step 4: 实现 custom 幂等成功事务**

创建 `src/server/generation/finalizeCustom.server.ts`：

```ts
import { readConfigInt } from "../config.server";
import { retentionExpiry } from "../r2.server";
import { tx } from "../tx.server";
import type { DebitInput } from "../money/debit.server";

export async function finalizeCustomSuccess(input: DebitInput): Promise<"succeeded" | "lost"> {
  return tx(async (client) => {
    const generation = await client.query(
      "SELECT status,credential_mode FROM generations WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [input.generationId, input.userId],
    );
    if (
      generation.rowCount === 0 ||
      generation.rows[0].status !== "running" ||
      generation.rows[0].credential_mode !== "custom"
    ) {
      return "lost";
    }
    const freeDays = await readConfigInt(client, "retention_free_days", 7);
    const paidDays = await readConfigInt(client, "retention_paid_days", 60);
    const user = await client.query("SELECT has_paid FROM users WHERE id=$1", [input.userId]);
    const expiresAt = retentionExpiry({ has_paid: Boolean(user.rows[0]?.has_paid) }, { freeDays, paidDays });
    await client.query(
      `INSERT INTO images(generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(generation_id) DO NOTHING`,
      [
        input.generationId,
        input.userId,
        input.storageKey,
        input.publicUrl,
        input.contentType ?? null,
        input.width ?? null,
        input.height ?? null,
        input.sizeBytes ?? null,
        expiresAt,
      ],
    );
    const updated = await client.query(
      `UPDATE generations SET status='succeeded',credits_charged_mp=0,completed_at=now(),
         duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
       WHERE id=$1 AND status='running' AND credential_mode='custom' RETURNING duration_ms`,
      [input.generationId],
    );
    if (updated.rowCount !== 1) return "lost";
    await client.query("INSERT INTO events(type,user_id,payload) VALUES('image_succeeded',$1,$2)", [
      input.userId,
      {
        generationId: input.generationId,
        credentialMode: "custom",
        creditsChargedMp: 0,
        durationMs: Number(updated.rows[0].duration_ms),
      },
    ]);
    await client.query("DELETE FROM generation_credentials WHERE generation_id=$1", [input.generationId]);
    return "succeeded";
  });
}
```

- [ ] **Step 5: 分流 Background 编排**

在 `src/server/generation/process.ts`：

1. import `loadCustomApiKey/deleteGenerationCredential`、`finalizeCustomSuccess`、`RelayCredential`。
2. system 才运行 `incCallIfUnderCap`、budget alert 和 `incMs`。
3. custom 在 claim 后只加载当前 generation 的 Key。
4. 调同一个 `callRelay` 时传 `credential` 与 `deadlineAt`。
5. storage/empty response 写显式 failureCode。

核心控制流替换为：

```ts
let credential: RelayCredential = { mode: "system" };
try {
  if (g.credentialMode === "custom") {
    credential = { mode: "custom", apiKey: await loadCustomApiKey(generationId) };
  }

  if (g.credentialMode === "system" && !(await incCallIfUnderCap())) {
    if (await markBudgetAlertedOnce()) {
      await alert("daily_budget_exhausted", { exhausted: true, source: "generation", generationId });
    }
    await sql`UPDATE generations SET status='failed',error_code='unknown',error='今日额度已满，请稍后',
              completed_at=now(),updated_at=now() WHERE id=${generationId} AND status='running'`;
    return "budget_exhausted";
  }

  const { images } = await callRelay({
    prompt: g.prompt,
    size: g.size,
    quality: g.quality,
    background: g.background,
    inputImage,
    credential,
    deadlineAt: g.deadlineAt,
  });
  if (!images.length) {
    throw Object.assign(new Error("生成服务返回异常"), { failureCode: "invalid_response" as const });
  }

let obj: Awaited<ReturnType<typeof realPutToR2>>;
try {
  obj = await putToR2(g.userId, generationId, images[0]);
} catch {
  throw Object.assign(new Error("图片保存失败，本次未扣积分，请重试"), {
    failureCode: "storage_failed" as const,
  });
}

if (g.credentialMode === "custom") {
  const outcome = await finalizeCustomSuccess({
    generationId,
    userId: g.userId,
    storageKey: obj.storageKey,
    publicUrl: obj.publicUrl,
    contentType: obj.contentType,
    width: obj.width ?? null,
    height: obj.height ?? null,
    sizeBytes: obj.sizeBytes,
  });
  return outcome === "succeeded" ? "succeeded" : "lost";
}
  await chargeOnSuccess({
    generationId,
    userId: g.userId,
    storageKey: obj.storageKey,
    publicUrl: obj.publicUrl,
    contentType: obj.contentType,
    width: obj.width ?? null,
    height: obj.height ?? null,
    sizeBytes: obj.sizeBytes,
  });
  return "succeeded";
} catch (err) {
  const secrets = credential.mode === "custom" ? [credential.apiKey] : [];
  const { code, message, httpStatus } = normalizeFailure(err, { mode: g.credentialMode, secrets });
  const updated = await sql`UPDATE generations SET status='failed',error_code=${code},error=${message},
                             http_status=${httpStatus ?? null},completed_at=now(),
                             duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
                            WHERE id=${generationId} AND status='running' RETURNING id`;
  if (updated.length > 0) {
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('image_failed',${g.userId},${JSON.stringify({ generationId, reason: code, credentialMode: g.credentialMode })}::jsonb)`;
  }
  return updated.length > 0 ? "failed" : "lost";
} finally {
  if (g.credentialMode === "custom") await deleteGenerationCredential(generationId);
  else await incMs(Date.now() - t0);
}
```

不得在任何日志打印 `credential` 或 request body。

更新 `tests/money/pipeline.test.ts` 的 system relay 桩，让它接受并断言 `credential.mode==='system'` 和 `deadlineAt instanceof Date`。

- [ ] **Step 6: 跑 system/custom 管线和钱回归**

Run: `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts tests/money/debit.test.ts`

Expected: PASS；custom 零 debit/零余额变化/清凭据，system 仍只扣一次。

- [ ] **Step 7: 提交**

```bash
git add src/server/money/preempt.server.ts src/server/generation/process.ts src/server/generation/finalizeCustom.server.ts tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts
git commit -m "feat: finalize custom generations without charging"
```

### Task 7: 统一五分钟 deadline、批量状态与凭据孤儿清理

**Files:**
- Create: `src/server/generation/deadline.server.ts`
- Create: `src/server/generation/status.server.ts`
- Create: `src/server/generation/status.server.test.ts`
- Create: `netlify/functions/cron-clean-generation-credentials.ts`
- Create: `tests/money/deadline.test.ts`
- Modify: `src/server/generation/scan.server.ts:1-51`
- Modify: `netlify/functions/generate-status.ts:1-59`
- Modify: `netlify/functions/cron-timeout-rescan.ts:1-24`
- Modify: `netlify.toml`
- Modify: `tests/money/timeout.test.ts:1-44`

- [ ] **Step 1: 写 queued/claimed/running、owner scope 和终态竞争测试**

创建 `tests/money/deadline.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteExpiredGenerationCredentials,
  encryptCustomApiKey,
} from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;
beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

describe("generation deadline", () => {
  it("expires every in-flight state, writes one event, and deletes custom credentials", async () => {
    const uid = await ctx.createUser({ balanceMp: 100 });
    const jobs = await Promise.all(
      ["queued", "claimed", "running"].map((status) =>
        ctx.createGeneration(uid, { status, credentialMode: "custom", deadlineAgoSec: 1 }),
      ),
    );
    for (const job of jobs) {
      const sealed = encryptCustomApiKey("sk-timeout-sentinel");
      await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                    VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,${sealed.expiresAt.toISOString()})`;
    }
    const expired = await expireDueGenerations({ userId: uid, now: new Date() });
    expect(expired).toHaveLength(3);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect((await ctx.events(uid, "image_failed")).filter((event) => JSON.stringify(event).includes("provider_timeout"))).toHaveLength(3);
    for (const job of jobs) expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect(await expireDueGenerations({ userId: uid, now: new Date() })).toHaveLength(0);
  });

  it("status read closes only the requesting owner jobs", async () => {
    const owner = await ctx.createUser();
    const other = await ctx.createUser();
    const ownJob = await ctx.createGeneration(owner, { deadlineAgoSec: 1 });
    const otherJob = await ctx.createGeneration(other, { deadlineAgoSec: 1 });
    const items = await loadGenerationStatuses(owner, [ownJob.generationId, otherJob.generationId]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ generationId: ownJob.generationId, status: "failed", errorCode: "provider_timeout" });
    expect((await ctx.gen(otherJob.generationId))?.status).toBe("queued");
  });

  it("deletes a 15 minute orphan credential without changing a fresh generation", async () => {
    const uid = await ctx.createUser();
    const job = await ctx.createGeneration(uid, { credentialMode: "custom" });
    const sealed = encryptCustomApiKey("sk-orphan");
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,now()-interval '1 second')`;
    expect(await deleteExpiredGenerationCredentials(new Date())).toBe(1);
    expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect((await ctx.gen(job.generationId))?.status).toBe("queued");
  });
});
```

创建 `src/server/generation/status.server.test.ts`：

```ts
// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseGenerationStatusQuery } from "./status.server";

describe("status query parsing", () => {
  it("keeps single-id compatibility and deduplicates a batch", () => {
    const first = randomUUID();
    const second = randomUUID();
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?id=${first}`)).toEqual({
      ok: true,
      single: true,
      ids: [first],
    });
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?ids=${first},${first},${second}`)).toEqual({
      ok: true,
      single: false,
      ids: [first, second],
    });
  });

  it("rejects both parameters, malformed UUIDs, and more than 50 ids", () => {
    const ids = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?id=${randomUUID()}&ids=${randomUUID()}`).ok).toBe(false);
    expect(parseGenerationStatusQuery("https://site.test/api/generate-status?ids=not-a-uuid").ok).toBe(false);
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?ids=${ids}`).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认 helper 不存在**

Run: `npm run test:money -- tests/money/deadline.test.ts`

Expected: FAIL，无法导入 deadline/status server helper。

Run: `npm run test:run -- src/server/generation/status.server.test.ts`

Expected: FAIL，`parseGenerationStatusQuery` 尚不存在。

- [ ] **Step 3: 实现原子 deadline 收口**

创建 `src/server/generation/deadline.server.ts`：

```ts
import { tx } from "../tx.server";

export interface ExpireDueArgs {
  generationIds?: string[];
  userId?: string;
  now?: Date;
}

export async function expireDueGenerations(args: ExpireDueArgs = {}): Promise<Array<{ id: string; userId: string }>> {
  const ids = args.generationIds?.length ? args.generationIds : null;
  const now = (args.now ?? new Date()).toISOString();
  const due = await getSql()`SELECT 1 FROM generations
                             WHERE status IN ('queued','claimed','running') AND deadline_at<=${now}
                               AND (${ids}::uuid[] IS NULL OR id=ANY(${ids}::uuid[]))
                               AND (${args.userId ?? null}::uuid IS NULL OR user_id=${args.userId ?? null}::uuid)
                             LIMIT 1`;
  if (due.length === 0) return [];
  return tx(async (client) => {
    const result = await client.query(
      `UPDATE generations
       SET status='failed',error_code='provider_timeout',
           error='请求超时，本次未扣积分，请重试',http_status=NULL,credits_charged_mp=0,
           completed_at=$1,duration_ms=(EXTRACT(EPOCH FROM $1::timestamptz-created_at)*1000)::int,updated_at=$1
       WHERE status IN ('queued','claimed','running') AND deadline_at<=$1
         AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[]))
         AND ($3::uuid IS NULL OR user_id=$3::uuid)
       RETURNING id,user_id,credential_mode`,
      [now, ids, args.userId ?? null],
    );
    for (const row of result.rows) {
      await client.query("INSERT INTO events(type,user_id,payload) VALUES('image_failed',$1,$2)", [
        row.user_id,
        { generationId: row.id, reason: "provider_timeout", credentialMode: row.credential_mode },
      ]);
      await client.query("DELETE FROM generation_credentials WHERE generation_id=$1", [row.id]);
    }
    return result.rows.map((row) => ({ id: row.id as string, userId: row.user_id as string }));
  });
}
```

同时从 `../../db/db.server` import `getSql`。这个 HTTP 预查让绝大多数每 2 秒 status 读取在“尚未到期”时不打开 Pool/WS 事务；真正到期仍由下方事务原子收口。

- [ ] **Step 4: 实现 owner-scoped 状态读取**

创建 `src/server/generation/status.server.ts`，先调用 `expireDueGenerations({generationIds,userId})`，再用一条 `WHERE g.id=ANY($ids) AND g.user_id=$userId` 查询。映射函数必须返回 Task 1 的联合字段：

```ts
import type { ErrorCode, GenerateStatusResponse } from "../../contracts/generate";
import { getSql } from "../../db/db.server";
import { z } from "zod";
import { expireDueGenerations } from "./deadline.server";

export type StatusQueryResult =
  | { ok: true; single: boolean; ids: string[] }
  | { ok: false };

export function parseGenerationStatusQuery(rawUrl: string): StatusQueryResult {
  const params = new URL(rawUrl).searchParams;
  const id = params.get("id");
  const rawIds = params.get("ids");
  if ((id && rawIds) || (!id && !rawIds)) return { ok: false };
  const ids = [...new Set(id ? [id] : (rawIds as string).split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > 50 || ids.some((value) => !z.uuid().safeParse(value).success)) {
    return { ok: false };
  }
  return { ok: true, single: Boolean(id), ids };
}

export async function loadGenerationStatuses(userId: string, ids: string[]): Promise<GenerateStatusResponse[]> {
  const uniqueIds = [...new Set(ids)].slice(0, 50);
  if (uniqueIds.length === 0) return [];
  await expireDueGenerations({ generationIds: uniqueIds, userId });
  const rows = await getSql()`SELECT g.id,g.credential_mode,g.deadline_at,g.status,g.started_at,g.created_at,
                                    g.error_code,g.error,g.http_status,g.duration_ms,g.credits_charged_mp,
                                    i.public_url,i.width,i.height
                             FROM generations g LEFT JOIN images i ON i.generation_id=g.id
                             WHERE g.id=ANY(${uniqueIds}::uuid[]) AND g.user_id=${userId}`;
  return rows.map((row) => {
    const identity = {
      generationId: row.id as string,
      credentialMode: row.credential_mode as "system" | "custom",
      deadlineAt: new Date(row.deadline_at as string).toISOString(),
    };
    if (row.status === "succeeded") {
      return {
        ...identity,
        status: "succeeded" as const,
        image: { publicUrl: row.public_url as string, width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height) },
        creditsChargedMp: Number(row.credits_charged_mp),
        durationMs: Number(row.duration_ms ?? 0),
      };
    }
    if (row.status === "failed") {
      return {
        ...identity,
        status: "failed" as const,
        errorCode: row.error_code as ErrorCode,
        error: String(row.error ?? "生成失败，请重试"),
        httpStatus: row.http_status == null ? null : Number(row.http_status),
        creditsChargedMp: 0 as const,
      } as GenerateStatusResponse;
    }
    const startedAt = row.started_at ? new Date(row.started_at as string).toISOString() : undefined;
    return {
      ...identity,
      status: row.status as "queued" | "claimed" | "running",
      startedAt,
      elapsedMs: row.started_at ? Math.max(0, Date.now() - new Date(row.started_at as string).getTime()) : undefined,
    };
  });
}
```

- [ ] **Step 5: 改造单项兼容 + 批量 status handler**

`netlify/functions/generate-status.ts` 调用同一个 parser：

```ts
const query = parseGenerationStatusQuery(req.url);
if (!query.ok) return httpError(400, "INVALID_PARAM", "任务 ID 无效");
const items = await loadGenerationStatuses(ctx.userId, query.ids);
if (query.single) {
  if (items.length === 0) return httpError(404, "NOT_FOUND", "任务不存在");
  return Response.json(items[0]);
}
return Response.json({ items });
```

新增 `parseGenerationStatusQuery/loadGenerationStatuses` imports。owner 不匹配的批量 ID 不回项、不暴露；单项保持 404。

- [ ] **Step 6: 让 cron 共用 helper 并清 15 分钟孤儿**

`src/server/generation/scan.server.ts` 的 `rescanTimeouts` 改为 `return expireDueGenerations()`；`dispatchStaleQueued` 查询增加 `deadline_at>now()`。

创建 `netlify/functions/cron-clean-generation-credentials.ts`：

```ts
import { alert } from "../../src/server/alert.server";
import { deleteExpiredGenerationCredentials } from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const expiredJobs = await expireDueGenerations();
    const deletedCredentials = await deleteExpiredGenerationCredentials();
    return Response.json({ ok: true, expiredJobs: expiredJobs.length, deletedCredentials });
  } catch (error) {
    await captureException(error, { cron: "clean-generation-credentials" });
    await alert("cron_failed", { cron: "clean-generation-credentials" });
    return new Response("cron error", { status: 500 });
  }
}
```

在 `netlify.toml` 增加：

```toml
[functions."cron-clean-generation-credentials"]
  schedule = "*/5 * * * *"
```

- [ ] **Step 7: 跑 deadline、旧 timeout 与 cron smoke**

Run: `npm run test:money -- tests/money/deadline.test.ts tests/money/timeout.test.ts`

Expected: PASS；旧 timeout 测试需改为写 `deadline_at=now()-interval '1 second'`，不再复制旧 `started_at<5min` SQL。

Run: `npm run test:run -- src/server/generation/status.server.test.ts`

Expected: PASS；单 ID、去重、非法 UUID、双参数和 51 IDs 全部覆盖。

Run: `node --env-file=.env --import tsx scripts/cron-smoke.ts`

Expected: exit 0；在现有检查数基础上新增 deadline 三状态与凭据清理检查并全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/server/generation/deadline.server.ts src/server/generation/status.server.ts src/server/generation/status.server.test.ts src/server/generation/scan.server.ts netlify/functions/generate-status.ts netlify/functions/cron-timeout-rescan.ts netlify/functions/cron-clean-generation-credentials.ts netlify.toml tests/money/deadline.test.ts tests/money/timeout.test.ts scripts/cron-smoke.ts
git commit -m "feat: enforce generation deadlines and batch status"
```

### Task 8: 增加顶部 Key 弹窗和响应式本地模式状态

**Files:**
- Create: `src/hooks/useUserApiConfig.ts`
- Create: `src/components/shell/ApiKeyModal.tsx`
- Create: `src/components/shell/ApiKeyModal.module.css`
- Create: `src/components/shell/ApiKeyModal.test.tsx`
- Modify: `src/components/shell/TopBar.tsx:1-89`
- Modify: `src/components/shell/TopBar.module.css`

- [ ] **Step 1: 写弹窗行为失败测试**

创建 `src/components/shell/ApiKeyModal.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserApiConfig } from "../../lib/userApiConfig";
import { ApiKeyModal } from "./ApiKeyModal";

describe("ApiKeyModal", () => {
  beforeEach(() => localStorage.clear());

  it("saves custom, retains it when switching system, and clears explicitly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const first = render(<ApiKeyModal userId="user-a" onClose={onClose} />);
    expect(screen.getByRole("radio", { name: "系统 Key" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "自定义 Key" }));
    await user.type(screen.getByLabelText("自定义 Key"), "sk-local-plain");
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", customApiKey: "sk-local-plain" });
    expect(onClose).toHaveBeenCalledOnce();

    first.unmount();
    render(<ApiKeyModal userId="user-a" onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "系统 Key" }));
    expect(loadUserApiConfig("user-a").customApiKey).toBe("sk-local-plain");
    await user.click(screen.getByRole("button", { name: "清除自定义 Key" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
  });

  it("shows the fixed read-only URL and validates blank input locally", async () => {
    const user = userEvent.setup();
    render(<ApiKeyModal userId="user-a" onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "自定义 Key" }));
    expect(screen.getByDisplayValue("https://api.tangguo.xin/v1")).toHaveAttribute("readOnly");
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义 Key");
  });
});
```

- [ ] **Step 2: 运行测试并确认组件不存在**

Run: `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx`

Expected: FAIL，无法导入 `ApiKeyModal`。

- [ ] **Step 3: 实现 React 配置 hook**

创建 `src/hooks/useUserApiConfig.ts`：

```ts
import { useCallback, useEffect, useState } from "react";
import {
  clearUserApiConfig,
  loadUserApiConfig,
  saveUserApiConfig,
  USER_API_CONFIG_EVENT,
  userApiConfigStorageKey,
  type UserApiConfig,
} from "../lib/userApiConfig";

export function useUserApiConfig(userId: string | undefined) {
  const [config, setConfig] = useState<UserApiConfig>(() =>
    userId ? loadUserApiConfig(userId) : { mode: "system", customApiKey: "" },
  );

  useEffect(() => {
    if (!userId) return;
    const reload = () => setConfig(loadUserApiConfig(userId));
    const onStorage = (event: StorageEvent) => {
      if (event.key === userApiConfigStorageKey(userId)) reload();
    };
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId === userId) reload();
    };
    reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener(USER_API_CONFIG_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(USER_API_CONFIG_EVENT, onLocal);
    };
  }, [userId]);

  const persist = useCallback(
    (value: UserApiConfig) => {
      if (!userId) return;
      saveUserApiConfig(userId, value);
      setConfig(value);
    },
    [userId],
  );
  const clear = useCallback(() => {
    if (!userId) return;
    clearUserApiConfig(userId);
    setConfig({ mode: "system", customApiKey: "" });
  }, [userId]);
  return { config, persist, clear };
}
```

- [ ] **Step 4: 实现可访问的 modal**

创建 `src/components/shell/ApiKeyModal.tsx`：

```tsx
import { Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  CUSTOM_RELAY_BASE_URL,
  MAX_CUSTOM_API_KEY_LENGTH,
} from "../../lib/userApiConfig";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useUserApiConfig } from "../../hooks/useUserApiConfig";
import styles from "./ApiKeyModal.module.css";

export function ApiKeyModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { config, persist, clear } = useUserApiConfig(userId);
  const [mode, setMode] = useState(config.mode);
  const [apiKey, setApiKey] = useState(config.customApiKey);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  useLockBodyScroll(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectMode = (next: "system" | "custom") => {
    setMode(next);
    setError("");
    if (next === "system") persist({ mode: "system", customApiKey: apiKey });
  };

  const save = () => {
    if (!apiKey.trim()) return setError("请输入自定义 Key");
    if (apiKey.length > MAX_CUSTOM_API_KEY_LENGTH) return setError("自定义 Key 不能超过 500 个字符");
    persist({ mode: "custom", customApiKey: apiKey });
    onClose();
  };

  const remove = () => {
    clear();
    setMode("system");
    setApiKey("");
    setError("");
  };

  return (
    <div className={styles.scrim} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.header}>
          <h2 id={titleId}><KeyRound size={18} />生图 Key</h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className={styles.segment} role="radiogroup" aria-label="Key 模式">
          <label><input type="radio" name="credential-mode" checked={mode === "system"} onChange={() => selectMode("system")} />系统 Key</label>
          <label><input type="radio" name="credential-mode" checked={mode === "custom"} onChange={() => setMode("custom")} />自定义 Key</label>
        </div>
        <p className={styles.description}>{mode === "system" ? "使用系统 Key，成功后按积分计费。" : "使用你的 Key，本次生成不扣积分。"}</p>
        {mode === "custom" ? (
          <div className={styles.fields}>
            <label htmlFor="custom-api-key">自定义 Key</label>
            <div className={styles.secretField}>
              <input id="custom-api-key" type={visible ? "text" : "password"} value={apiKey} maxLength={MAX_CUSTOM_API_KEY_LENGTH} onChange={(event) => { setApiKey(event.target.value); setError(""); }} autoComplete="off" />
              <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏 Key" : "显示 Key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            <label htmlFor="custom-base-url">Base URL</label>
            <input id="custom-base-url" value={CUSTOM_RELAY_BASE_URL} readOnly />
            <span className={styles.readonlyHint}>固定地址，不可修改</span>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        ) : null}
        <footer className={styles.actions}>
          <button type="button" className={styles.clear} onClick={remove} disabled={!apiKey}><Trash2 size={16} />清除自定义 Key</button>
          {mode === "custom" ? <button type="button" className={styles.save} onClick={save}>保存并使用</button> : null}
        </footer>
      </section>
    </div>
  );
}
```

`ApiKeyModal.module.css` 使用已有 tokens，稳定尺寸至少包含：

```css
.scrim { position: fixed; inset: 0; z-index: var(--z-modal, 80); display: grid; place-items: center; padding: 16px; background: var(--scrim); }
.dialog { width: min(360px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: var(--space-5); border: .5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); box-shadow: var(--shadow-lg); }
.header,.actions,.secretField { display: flex; align-items: center; }
.header,.actions { justify-content: space-between; gap: var(--space-3); }
.header h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 16px; letter-spacing: 0; }
.iconButton,.secretField button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-secondary); }
.segment { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 4px; margin-top: var(--space-4); padding: 4px; border: .5px solid var(--border-subtle); border-radius: 8px; }
.segment label { min-width: 0; padding: 8px; text-align: center; font-size: 13px; }
.description,.readonlyHint { color: var(--text-tertiary); font-size: 12px; }
.fields { display: grid; gap: var(--space-2); }
.fields input { width: 100%; min-width: 0; height: 40px; padding: 0 12px; border: .5px solid var(--border-strong); border-radius: 8px; background: var(--bg-surface); color: var(--text-primary); }
.secretField input { padding-right: 40px; }
.secretField button { margin-left: -40px; flex: 0 0 40px; }
.error { margin: 0; color: var(--text-danger); font-size: 12px; }
.actions { margin-top: var(--space-5); flex-wrap: wrap; }
.clear,.save { min-height: 38px; display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; border-radius: 8px; }
.save { margin-left: auto; border: 0; background: var(--primary-bg); color: var(--primary-fg); }
@media (max-width: 380px) { .actions > button { width: 100%; justify-content: center; } .save { margin-left: 0; } }
```

- [ ] **Step 5: 接入 TopBar 的 KeyRound 图标**

`TopBar.tsx` import `KeyRound`、`useState`、`ApiKeyModal`；在通知铃铛前加入：

```tsx
const [keyModalOpen, setKeyModalOpen] = useState(false);
const userId = me.data?.user.id;

{userId ? (
  <button
    type="button"
    className={styles.iconBtn}
    onClick={() => setKeyModalOpen(true)}
    aria-label="生图 Key 设置"
    title="生图 Key 设置"
  >
    <KeyRound size={17} />
  </button>
) : null}
{keyModalOpen && userId ? <ApiKeyModal userId={userId} onClose={() => setKeyModalOpen(false)} /> : null}
```

确保 `.right` 不允许按钮被内容挤缩，`.iconBtn` 固定宽高；360px 下可隐藏积分文字但保留 coin/icon 与可访问名称，不隐藏 Key 入口。

- [ ] **Step 6: 运行组件测试、类型和构建**

Run: `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx src/lib/userApiConfig.test.ts`

Expected: PASS。

Run: `npm run typecheck && npm run build`

Expected: typecheck/build exit 0；TopBar、modal 和当前 system-only Composer 调用均可编译。

- [ ] **Step 7: 提交**

```bash
git add src/hooks/useUserApiConfig.ts src/components/shell/ApiKeyModal.tsx src/components/shell/ApiKeyModal.module.css src/components/shell/ApiKeyModal.test.tsx src/components/shell/TopBar.tsx src/components/shell/TopBar.module.css
git commit -m "feat: add user key mode settings"
```

### Task 9: 改为多任务提交和当前会话批量轮询

**Files:**
- Create: `src/lib/generationBatch.ts`
- Create: `src/lib/generationBatch.test.ts`
- Modify: `src/contracts/conversation.ts:18-44`
- Modify: `src/hooks/useGeneration.ts:1-121`
- Modify: `src/hooks/useGenerationStatus.ts:1-28`
- Modify: `src/components/conversation/ConversationView.tsx:1-328`
- Modify: `src/components/composer/Composer.tsx:1-328`
- Modify: `src/server/reads.server.ts:86-127`

- [ ] **Step 1: 写 pending 集合与批量合并失败测试**

创建 `src/lib/generationBatch.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ConversationGeneration } from "../contracts/conversation";
import { pendingGenerationIds, terminalStatusSignature } from "./generationBatch";

const turn = (id: string, status: ConversationGeneration["status"]): ConversationGeneration => ({
  id,
  prompt: id,
  size: "auto",
  quality: null,
  background: null,
  credentialMode: "custom",
  deadlineAt: "2026-07-11T12:05:00.000Z",
  status,
  errorCode: null,
  error: null,
  httpStatus: null,
  creditsChargedMp: 0,
  durationMs: null,
  createdAt: "2026-07-11T12:00:00.000Z",
  image: null,
});

describe("generation batch", () => {
  it("tracks every in-flight turn, not only the first", () => {
    expect(pendingGenerationIds([turn("a", "running"), turn("b", "queued"), turn("c", "succeeded")])).toEqual(["a", "b"]);
  });

  it("changes the terminal signature for any completed item", () => {
    expect(terminalStatusSignature([{ generationId: "a", status: "succeeded" }, { generationId: "b", status: "running" }])).toBe("a:succeeded");
  });
});
```

- [ ] **Step 2: 运行测试并确认 helper 不存在**

Run: `npm run test:run -- src/lib/generationBatch.test.ts`

Expected: FAIL，无法导入 `generationBatch`。

- [ ] **Step 3: 实现稳定 pending helper**

创建 `src/lib/generationBatch.ts`：

```ts
import type { ConversationGeneration } from "../contracts/conversation";

export function pendingGenerationIds(turns: ConversationGeneration[]): string[] {
  return turns
    .filter((turn) => turn.status === "queued" || turn.status === "claimed" || turn.status === "running")
    .map((turn) => turn.id);
}

export function terminalStatusSignature(items: Array<{ generationId: string; status: string }>): string {
  return items
    .filter((item) => item.status === "succeeded" || item.status === "failed")
    .map((item) => `${item.generationId}:${item.status}`)
    .sort()
    .join("|");
}
```

- [ ] **Step 4: 把提交参数与凭据配置分开**

`src/hooks/useGeneration.ts` 改用 `GenerateParams`。`submit` 签名：

```ts
const submit = useCallback(
  (params: GenerateParams, apiConfig: UserApiConfig, file: File | null = null, onAccepted?: () => void) => {
```

乐观 turn 增加：

```ts
credentialMode: apiConfig.mode,
deadlineAt: new Date(Date.parse(createdAt) + 5 * 60_000).toISOString(),
```

实际 POST payload 使用条件展开，保证 system body 没有 custom Key：

```ts
const credentialFields =
  apiConfig.mode === "custom"
    ? { credentialMode: "custom" as const, customApiKey: apiConfig.customApiKey }
    : { credentialMode: "system" as const };
const accepted = await apiPost(
  "/api/generate",
  { ...params, ...credentialFields, conversationId: cid, generationId: gid, inputImageKey },
  GenerateAcceptedResponse,
);
```

`submittingRef` 仍从点击/上传开始锁到 202 或失败，finally 立即释放；不引入 generation 终态锁。

- [ ] **Step 5: 把单 ID hook 改为一次批量请求**

用以下实现替换 `src/hooks/useGenerationStatus.ts`：

```ts
import { useQuery } from "@tanstack/react-query";
import { GenerateStatusBatchResponse } from "../contracts/generate";
import { apiGet } from "../lib/api-client";

export function useGenerationStatuses(generationIds: string[], deadlineAts: string[]) {
  const ids = [...new Set(generationIds)].sort();
  const query = ids.join(",");
  const maxDeadline = Math.max(0, ...deadlineAts.map((value) => Date.parse(value)).filter(Number.isFinite));
  return useQuery({
    queryKey: ["generation-statuses", ids],
    enabled: ids.length > 0,
    queryFn: () => apiGet(`/api/generate-status?ids=${encodeURIComponent(query)}`, GenerateStatusBatchResponse),
    refetchInterval: (state) => {
      const items = state.state.data?.items ?? [];
      if (items.length > 0 && items.every((item) => item.status === "succeeded" || item.status === "failed")) return false;
      if (maxDeadline > 0 && Date.now() > maxDeadline + 10_000) return false;
      return 2_000;
    },
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}
```

保留一个 `useGenerationStatus(id)` compatibility wrapper 仅在仍有独立调用点时使用；新 ConversationView 只能调用 batch hook 一次。

- [ ] **Step 6: 更新读取契约和 ConversationView**

在 `src/contracts/conversation.ts` 的 `ConversationGeneration` 增加必填字段：

```ts
credentialMode: z.enum(["system", "custom"]),
deadlineAt: z.string(),
```

`src/server/reads.server.ts` 查询增加 `g.credential_mode,g.deadline_at`，映射：

```ts
credentialMode: g.credential_mode as "system" | "custom",
deadlineAt: iso(g.deadline_at),
```

`ConversationView.tsx`：

```ts
const userId = me.data?.user.id;
const { config: apiConfig } = useUserApiConfig(userId);
const pendingTurns = turns.filter((turn) =>
  turn.status === "queued" || turn.status === "claimed" || turn.status === "running",
);
const generationStatuses = useGenerationStatuses(
  pendingTurns.map((turn) => turn.id),
  pendingTurns.map((turn) => turn.deadlineAt),
);
const terminalSignature = terminalStatusSignature(generationStatuses.data?.items ?? []);
const isGenerating = isSubmitting;
const canAfford = apiConfig.mode === "custom" || balanceMp >= priceMp;
```

终态 effect：

```ts
useEffect(() => {
  if (!terminalSignature || !conv) return;
  qc.invalidateQueries({ queryKey: ["conversation", conv.id] });
  if (generationStatuses.data?.items.some((item) => item.status === "succeeded" && item.credentialMode === "system")) {
    qc.invalidateQueries({ queryKey: ["me", "balance"] });
  }
  if (generationStatuses.data?.items.some((item) => item.status === "succeeded")) {
    qc.invalidateQueries({ queryKey: ["assets"] });
  }
}, [terminalSignature, conv?.id]);
```

删除旧的 `pendingTurn/pendingId/forceTick/TIMEOUT_MS` 单项逻辑。`runGeneration` 只在 system 余额不足时拦：

```ts
if (apiConfig.mode === "system" && balanceMp < priceMp) {
  toast.error("积分不足，去充值");
  return;
}
if (apiConfig.mode === "custom" && !apiConfig.customApiKey.trim()) {
  toast.error("请先填写并保存自定义 Key");
  return;
}
submit(req, apiConfig, file, onAccepted);
```

`bringBackPrompt` 和 `regenerate` 只在 `isSubmitting` 为 true 时挡同一次 enqueue，不再因 pending generation 挡。Composer 传：

```tsx
disabled={isSubmitting}
credentialMode={apiConfig.mode}
canAfford={canAfford}
```

失败文案补全 Task 1 的 active codes；`provider_timeout` 必须精确显示“请求超时，本次未扣积分，请重试”。

- [ ] **Step 7: 更新 Composer 的 mode-aware 提示和 Enter 行为**

`ComposerProps.request/onChange` 改为 `GenerateParams`，新增 `credentialMode: CredentialMode`。Enter 与按钮判断：

```ts
const maySubmit = credentialMode === "custom" || canAfford;
if (maySubmit) onSubmit();
else navigate("/billing");
```

右侧提示：

```tsx
{credentialMode === "custom" ? (
  <span className={styles.costHint}>使用自定义 Key · 不扣积分</span>
) : canAfford ? (
  <span className={styles.costHint}>
    本次消耗 <span className={styles.costStrong}>{formatCredits(pricePerImageMp)}</span> 积分 / 剩余 {formatCredits(balanceMp)} 积分
  </span>
) : null}
```

custom 下发送按钮与 Enter 不导航充值页；`disabled` 只代表当前 enqueue/上传动作，上传控件在 202 后恢复。

- [ ] **Step 8: 运行 unit、组件基础回归和类型检查**

Run: `npm run test:run -- src/lib/generationBatch.test.ts src/phase1.test.tsx src/components/shell/ApiKeyModal.test.tsx`

Expected: PASS。`phase1.test.tsx` 同步把 import/baseReq 改为 `GenerateParams`，移除 Task 1 的迁移期 `credentialMode` 字段，并给 3 个 `<Composer>` 调用显式传 `credentialMode="system"`；ConversationDetail fixture 若存在则补齐真实 `credentialMode/deadlineAt`，不把必填 schema 放宽为 optional。

Run: `npm run typecheck`

Expected: exit 0，无 `GenerateRequest`/`GenerateParams`、status union 或 hook 调用错误。

- [ ] **Step 9: 提交**

```bash
git add src/lib/generationBatch.ts src/lib/generationBatch.test.ts src/contracts/conversation.ts src/hooks/useGeneration.ts src/hooks/useGenerationStatus.ts src/components/conversation/ConversationView.tsx src/components/composer/Composer.tsx src/server/reads.server.ts src/phase1.test.tsx
git commit -m "feat: track multiple generation jobs per conversation"
```

### Task 10: 后台 mode 可见性、运行时秘密哨兵与可观测脱敏

**Files:**
- Create: `tests/money/custom-key-security.test.ts`
- Modify: `src/server/admin/generations.server.ts:10-83`
- Modify: `app/routes/_admin.generations.tsx:135-204`
- Modify: `src/server/sentry.server.ts:1-67`
- Modify: `netlify/functions/generate-background.ts:1-16`
- Modify: `scripts/assert-no-secrets-in-bundle.ts:14-37`

- [ ] **Step 1: 写服务端 plaintext 哨兵和 admin 响应失败测试**

创建 `tests/money/custom-key-security.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listGenerations } from "../../src/server/admin/generations.server";
import { captureException } from "../../src/server/sentry.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { runGenerationJob } from "../../src/server/generation/process";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { type TestCtx, newCtx } from "./_helpers";

const sentinel = "custom-runtime-9f4c7d2a-key";
const originalMaster = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalMaster;
  vi.restoreAllMocks();
  await ctx.cleanup();
});

describe("custom key runtime sentinel", () => {
  it("never reaches normal tables, status/admin responses, logs, or Sentry fallback", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const accepted = await enqueueGeneration({
      user: { id: uid, maxConcurrency: 1 },
      input: { prompt: "sentinel", size: "auto", credentialMode: "custom", customApiKey: sentinel },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runGenerationJob(accepted.generationId, {
      callRelay: async () => {
        throw Object.assign(new Error(`401 provider echoed ${sentinel}`), { httpStatus: 401 });
      },
    });
    await captureException(new Error(`observer echoed ${sentinel}`), { generationId: accepted.generationId }, [sentinel]);

    const normalData = await ctx.sql`
      SELECT row_to_json(g)::text AS value FROM generations g WHERE g.id=${accepted.generationId}
      UNION ALL SELECT row_to_json(e)::text FROM events e WHERE e.user_id=${uid}
      UNION ALL SELECT row_to_json(i)::text FROM images i WHERE i.user_id=${uid}
      UNION ALL SELECT row_to_json(a)::text FROM audit_log a WHERE a.target_id=${accepted.generationId}`;
    expect(JSON.stringify(normalData)).not.toContain(sentinel);
    expect(JSON.stringify(await loadGenerationStatuses(uid, [accepted.generationId]))).not.toContain(sentinel);
    const [user] = await ctx.sql`SELECT email FROM users WHERE id=${uid}`;
    const admin = await listGenerations({ from: "2020-01-01", userEmail: String(user.email), pageSize: 10 });
    const adminItem = admin.items.find((item) => item.id === accepted.generationId);
    expect(adminItem).toMatchObject({ credentialMode: "custom", creditsChargedMp: 0 });
    expect(JSON.stringify(adminItem)).not.toContain(sentinel);
    expect(JSON.stringify(adminItem)).not.toContain("ciphertext");
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(error.mock.calls)).not.toContain(sentinel);
  });
});
```

- [ ] **Step 2: 运行测试并确认 Sentry fallback 仍打印原始 Error**

Run: `npm run test:money -- tests/money/custom-key-security.test.ts`

Expected: FAIL；当前 `captureException` 的 console fallback 含 sentinel，admin item 也尚无 mode/charge 字段。

- [ ] **Step 3: 让 admin 只显示 mode 和扣费，不查询 credential 表**

`AdminGeneration` 增加：

```ts
credentialMode: "system" | "custom";
creditsChargedMp: number;
```

`listGenerations` SELECT 增加 `g.credential_mode,g.credits_charged_mp`，映射：

```ts
credentialMode: r.credential_mode as "system" | "custom",
creditsChargedMp: toInt(r.credits_charged_mp),
```

查询不得 join/select `generation_credentials`。在 `app/routes/_admin.generations.tsx` 的“尺寸”后增加表头“模式”“扣费”，行内容：

```tsx
<td className={styles.td}>
  <span className={styles.badge}>{g.credentialMode === "custom" ? "自定义" : "系统"}</span>
</td>
<td className={styles.td}>{g.creditsChargedMp === 0 ? "0" : formatCredits(g.creditsChargedMp)}</td>
```

从 `src/lib/format` 同时 import `formatCredits`。custom 失败/成功都显示 0；system 显实际 mp 转积分。

- [ ] **Step 4: 脱敏 Sentry/console 观察出口**

在 `src/server/sentry.server.ts` import `redactSecrets`，增加：

```ts
function observationSecrets(extra: string[] = []): string[] {
  return [process.env.RELAY_API_KEY ?? "", ...extra].filter(Boolean);
}

function safeObservedError(error: unknown, secrets: string[]): Error {
  const value = error as { name?: string; message?: string };
  const safe = new Error(redactSecrets(String(value?.message ?? "internal error"), secrets));
  safe.name = value?.name ?? "Error";
  return safe;
}
```

把签名改为：

```ts
export async function captureException(
  error: unknown,
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeError = safeObservedError(error, secrets);
  const safeContext = context ? redactSecrets(context, secrets) : undefined;
  console.error("[sentry:exception]", safeError, safeContext ? JSON.stringify(safeContext) : "");
  const sentry = await getSentry();
  try {
    sentry?.captureException(safeError, safeContext ? { extra: safeContext } : undefined);
  } catch (captureError) {
    console.error("[sentry] captureException 自身失败", safeObservedError(captureError, secrets));
  }
}
```

把 `captureMessage` 同步改为：

```ts
export async function captureMessage(
  message: string,
  level: SentryLevel = "warning",
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeMessage = redactSecrets(message, secrets);
  const safeContext = context ? redactSecrets(context, secrets) : undefined;
  console.warn(`[sentry:${level}] ${safeMessage}`, safeContext ? JSON.stringify(safeContext) : "");
  const sentry = await getSentry();
  try {
    sentry?.captureMessage(safeMessage, { level, extra: safeContext });
  } catch (captureError) {
    console.error("[sentry] captureMessage 自身失败", safeObservedError(captureError, secrets));
  }
}
```

默认 `extraSecrets=[]`，现有调用不需要机械改签名。

`netlify/functions/generate-background.ts` catch 不打印原始异常，改为：

```ts
} catch {
  console.error("[generate-background] internal failure");
  return Response.json({ error: "internal" }, { status: 500 });
}
```

正常 provider 错误必须在 `runGenerationJob` 内先按实际 Key 脱敏并收口；到 handler 的异常只保留固定信号。

- [ ] **Step 5: 扩展静态 secrets 断言**

在 `scripts/assert-no-secrets-in-bundle.ts` 的 `SECRET_ENV_NAMES` 加：

```ts
"CUSTOM_KEY_JOB_ENCRYPTION_KEY",
```

`STRUCT_MARKERS` 加：

```ts
"generation_credentials",
```

这不会禁止浏览器运行时保存用户自己输入的 Key；它只禁止服务端主密钥/内部表名被打进静态 bundle。

- [ ] **Step 6: 跑安全哨兵、admin 和静态断言**

Run: `npm run test:money -- tests/money/custom-key-security.test.ts`

Expected: PASS；normal tables/status/admin/log/Sentry fallback 均不含 sentinel。

Run: `npm run build && npm run assert-no-secrets`

Expected: build exit 0，静态断言 PASS，扫描项包含新 env 与 credential 表名。

- [ ] **Step 7: 提交**

```bash
git add tests/money/custom-key-security.test.ts src/server/admin/generations.server.ts app/routes/_admin.generations.tsx src/server/sentry.server.ts netlify/functions/generate-background.ts scripts/assert-no-secrets-in-bundle.ts
git commit -m "feat: expose generation modes without leaking credentials"
```

### Task 11: Playwright 验收、全量回归和交接状态

**Files:**
- Create: `tests/e2e/key-modes.spec.ts`
- Modify: `.env.example`
- Modify: `docs/PROGRESS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/dev/deploy.md`

- [ ] **Step 1: 写前端 mode/multi-task Playwright 用例**

创建 `tests/e2e/key-modes.spec.ts`。该用例拦截本站生图端点，不调用真实中转；server/DB 分流已由 money tests 覆盖：

```ts
import { expect, test } from "@playwright/test";

test("custom key modal and two concurrent turns", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  const deadlines = new Map<string, string>();
  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    requests.push(body);
    const deadlineAt = new Date(Date.now() + 5 * 60_000).toISOString();
    deadlines.set(body.generationId, deadlineAt);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        generationId: body.generationId,
        conversationId: body.conversationId,
        status: "queued",
        credentialMode: body.credentialMode,
        deadlineAt,
      }),
    });
  });
  await page.route("**/api/generate-status?**", async (route) => {
    const ids = decodeURIComponent(new URL(route.request().url()).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: ids.map((generationId) => ({
          generationId,
          credentialMode: "custom",
          deadlineAt: deadlines.get(generationId),
          status: "running",
        })),
      }),
    });
  });

  const email = `key-e2e+${Date.now()}@example.com`;
  await page.goto("/register");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("test123456");
  await page.locator("#confirm").fill("test123456");
  await page.getByRole("button", { name: "注册" }).click();
  await page.waitForURL("**/");

  await page.getByRole("button", { name: "生图 Key 设置" }).click();
  await page.getByRole("radio", { name: "自定义 Key" }).click();
  await page.getByLabel("自定义 Key").fill("sk-e2e-custom");
  await expect(page.getByDisplayValue("https://api.tangguo.xin/v1")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "保存并使用" }).click();

  await page.getByPlaceholder("描述你想生成的画面…").fill("first concurrent prompt");
  await page.getByRole("button", { name: "生成" }).click();
  await page.getByPlaceholder("继续在当前对话生图…").fill("second concurrent prompt");
  await page.getByRole("button", { name: "生成" }).click();

  await expect.poll(() => requests.length).toBe(2);
  expect(requests.every((body) => body.credentialMode === "custom" && body.customApiKey === "sk-e2e-custom")).toBe(true);
  expect(requests.every((body) => !("baseUrl" in body))).toBe(true);
  await expect(page.getByText(/生成中/)).toHaveCount(2);
  await page.screenshot({ path: "test-results/key-modes-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "生图 Key 设置" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/key-modes-mobile.png", fullPage: true });
});
```

- [ ] **Step 2: 启动本地 Netlify server 并运行 Playwright**

Terminal A:

```powershell
Remove-Item -Recurse -Force build, .netlify -ErrorAction SilentlyContinue
npm run dev:netlify
```

Expected: `http://localhost:8888` 可访问，Functions 路由已加载。

Terminal B:

```powershell
$env:E2E_BASE_URL='http://localhost:8888'
npm run test:e2e -- tests/e2e/key-modes.spec.ts
```

Expected: 1 Playwright test PASS，生成 desktop/mobile 两张截图。人工打开截图确认 Key 图标、modal、最长标签和两张 pending 卡无重叠/截断。

- [ ] **Step 3: 跑完整新鲜验证**

依次执行，不复用旧输出：

```powershell
npm run typecheck
npm run test:run
npm run test:money
node --env-file=.env --import tsx scripts/cron-smoke.ts
npm run build
npm run assert-no-secrets
```

Expected:

- `typecheck` exit 0。
- 默认 Vitest 0 failures，包含 contract/local config/modal/batch/relay/failure/redaction。
- money Vitest 0 failures，包含 system 回归、custom 零扣费、deadline、security sentinel。
- cron smoke 全检查通过，包含三种中间态 deadline 与 credential orphan cleanup。
- build exit 0，assert-no-secrets PASS。

- [ ] **Step 4: 做逐条安全和需求复核**

Run:

```powershell
rg -n "api/generate/custom|RELAY_API_KEY.*localStorage|customApiKey.*console|generation_credentials.*SELECT" src app netlify tests scripts
rg -n "CUSTOM_KEY_REQUIRED|custom_key_invalid|custom_key_quota|relay_rate_limited|provider_timeout|storage_failed" src netlify tests
```

Expected: 第一条不出现第二端点、system Key 本地存储、custom Key 日志或 admin credential SELECT；允许的 `generation_credentials SELECT` 仅在 `credential.server.ts` 按 generationId 取密文。第二条覆盖 contract、mapper、UI 文案和测试。

- [ ] **Step 5: 同步 env 模板和当前状态**

在 `.env.example` 增加名字和说明，不写真实值：

```dotenv
# 32-byte base64 key for generation-scoped custom API key AES-256-GCM encryption.
CUSTOM_KEY_JOB_ENCRYPTION_KEY=
```

只有完成本地实现/测试时，把 `docs/PROGRESS.md` 里里程碑 13 改为“本地实现完成、待生产部署”，写入本次真实测试数字和 commit。只有按 [deploy.md §6](../../dev/deploy.md) 完成 migration/env/生产 smoke 后，才把 `CLAUDE.md` 与 PROGRESS 改为“已上线”；未部署时继续保留生产 system-only 说明。

- [ ] **Step 6: 提交实现与验证记录**

```bash
git add tests/e2e/key-modes.spec.ts .env.example docs/PROGRESS.md CLAUDE.md docs/dev/deploy.md
git commit -m "test: verify key modes and multi-task generation"
```

## 计划自检

| PRD 范围 | 覆盖 task |
|---|---|
| 顶栏入口、单选、显隐、保存/切换/清除、固定 URL、user-scoped 明文 | 1、8、11 |
| 统一 `/api/generate`、mode 契约、无第二端点 | 1、4、11 |
| generation-scoped 加密、原子创建、终态/15min 删除 | 2、3、4、6、7、10 |
| system 钱/预算/并发不回归；custom 零扣费零限制 | 4、6、10、11 |
| 同一 relay 的 t2i/i2i、无自动 fallback、精确错误码 | 5、6、11 |
| 多任务提交、批量 owner-scoped 状态、刷新恢复 | 7、9、11 |
| 两种模式统一五分钟 deadline、30 秒预留、终态竞争 | 2、5、7、11 |
| 同一存储/历史/资产/保留期 | 6、9、11 |
| plaintext 不进普通 DB/log/event/audit/Sentry/响应/admin | 3、5、6、7、10、11 |

执行者完成计划后，重新扫描本文是否存在未勾步骤，并以 Task 11 的完整命令输出作为完成证据。不要用旧的 2026-06-23 测试数字代替新鲜验证。
