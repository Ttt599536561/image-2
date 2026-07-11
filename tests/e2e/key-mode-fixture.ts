import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { loadDisposableTestEnv } from "../../scripts/test-env-guard";

const env = loadDisposableTestEnv();
for (const name of [
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "CUSTOM_KEY_JOB_ENCRYPTION_KEY",
] as const) {
  if (!env[name]) throw new Error(`[key-mode-e2e] missing ${name} in disposable test env`);
}
if (env.CUSTOM_KEY_MODES_ENABLED !== "true") {
  throw new Error("[key-mode-e2e] custom modes must be enabled in the disposable test env");
}

const pool = new Pool({
  connectionString: env.DATABASE_URL_UNPOOLED,
  allowExitOnIdle: true,
  max: 4,
});

export interface TestUser {
  id: string;
  email: string;
}

const testPassword = ["E2E", "local", "2026", "only"].join("-");

export async function registerTestUser(page: Page): Promise<TestUser> {
  const email = `key-modes-${randomUUID()}@example.test`;
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "注册" })).toHaveAttribute(
    "data-auth-ready",
    "true",
  );
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(testPassword);
  await page.locator("#confirm").fill(testPassword);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/sign-up/email"),
  );
  await page.getByRole("button", { name: "注册" }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`[key-mode-e2e] registration failed with HTTP ${response.status()}`);
  }
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });

  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email=$1 LIMIT 1',
    [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("[key-mode-e2e] registered test user was not persisted");
  return { id, email };
}

export async function loginTestUser(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toHaveAttribute(
    "data-auth-ready",
    "true",
  );
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(testPassword);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "登录" }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`[key-mode-e2e] login failed with HTTP ${response.status()}`);
  }
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
}

export async function cleanupTestUsers(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [emails]);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
}

export async function setBalanceZero(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE credit_lots SET remaining_mp=0 WHERE user_id=$1", [userId]);
    await client.query("UPDATE credit_accounts SET balance_mp=0 WHERE user_id=$1", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type TerminalFailureCode =
  | "provider_timeout"
  | "relay_unreachable"
  | "insufficient_quota"
  | "content_rejected"
  | "invalid_request"
  | "relay_5xx"
  | "custom_key_invalid"
  | "custom_key_quota"
  | "relay_rate_limited"
  | "invalid_response"
  | "storage_failed"
  | "unknown";

interface GenerationRow {
  id: string;
  credential_mode: "system" | "custom";
  deadline_at: Date;
  status: "queued" | "claimed" | "running" | "succeeded" | "failed";
  error_code: TerminalFailureCode | null;
  error: string | null;
  http_status: number | null;
  credits_charged_mp: string | number;
  duration_ms: number | null;
}

export interface GenerationHarness {
  requests: Record<string, unknown>[];
  readonly statusRequestCount: number;
  completeSuccess(generationId: string): Promise<void>;
  completeFailure(generationId: string, code?: TerminalFailureCode): Promise<void>;
  removeGeneration(generationId: string): Promise<void>;
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export async function installGenerationHarness(
  page: Page,
  userId: string,
  options: { deadlineOffsetMs?: number } = {},
): Promise<GenerationHarness> {
  const requests: Record<string, unknown>[] = [];
  let statusRequestCount = 0;

  await page.route("**/e2e-generated.png", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: tinyPng });
  });

  await page.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const conversationId = String(body.conversationId ?? "");
    const generationId = String(body.generationId ?? "");
    const credentialMode = body.credentialMode === "custom" ? "custom" : "system";
    const deadlineAt = new Date(Date.now() + (options.deadlineOffsetMs ?? 5 * 60_000));
    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO conversations(id, user_id, title, created_at, updated_at)
         VALUES($1, $2, $3, $4, $4)
         ON CONFLICT (id) DO NOTHING`,
        [conversationId, userId, String(body.prompt ?? "").slice(0, 20), now],
      );
      await client.query(
        `INSERT INTO generations(
           id, conversation_id, user_id, prompt, size, quality, background,
           credential_mode, deadline_at, status, created_at, updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          generationId,
          conversationId,
          userId,
          String(body.prompt ?? ""),
          String(body.size ?? "auto"),
          body.quality ?? null,
          body.background ?? null,
          credentialMode,
          deadlineAt,
          now,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        generationId,
        conversationId,
        status: "queued",
        credentialMode,
        deadlineAt: deadlineAt.toISOString(),
      }),
    });
  });

  await page.route("**/api/generate-status?*", async (route) => {
    statusRequestCount += 1;
    const url = new URL(route.request().url());
    const ids = (url.searchParams.get("ids") ?? url.searchParams.get("id") ?? "")
      .split(",")
      .filter(Boolean);
    const result = await pool.query<GenerationRow>(
      `SELECT id, credential_mode, deadline_at, status, error_code, error, http_status,
              credits_charged_mp, duration_ms
       FROM generations
       WHERE user_id=$1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    const items = result.rows.map((row) => {
      const identity = {
        generationId: row.id,
        credentialMode: row.credential_mode,
        deadlineAt: row.deadline_at.toISOString(),
      };
      if (row.status === "succeeded") {
        return {
          ...identity,
          status: "succeeded",
          image: {
            publicUrl: "http://localhost:8888/e2e-generated.png",
            width: 1,
            height: 1,
          },
          creditsChargedMp: Number(row.credits_charged_mp),
          durationMs: row.duration_ms ?? 1_000,
        };
      }
      if (row.status === "failed") {
        return {
          ...identity,
          status: "failed",
          errorCode: row.error_code ?? "unknown",
          error: row.error ?? "generation failed",
          httpStatus: row.http_status,
          creditsChargedMp: 0,
        };
      }
      return { ...identity, status: row.status };
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, missingIds: ids.filter((id) => !byId.has(id)) }),
    });
  });

  return {
    requests,
    get statusRequestCount() {
      return statusRequestCount;
    },
    async completeSuccess(generationId: string) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE generations
           SET status='succeeded', error_code=NULL, error=NULL, http_status=200,
               credits_charged_mp=0, duration_ms=1000, completed_at=now(), updated_at=now()
           WHERE id=$1 AND user_id=$2 AND status IN ('queued','claimed','running')`,
          [generationId, userId],
        );
        await client.query(
          `INSERT INTO images(
             id, generation_id, user_id, storage_key, public_url, content_type,
             width, height, size_bytes, saved_to_library
           ) VALUES($1,$2,$3,$4,$5,'image/png',1,1,68,false)
           ON CONFLICT (generation_id) DO NOTHING`,
          [
            randomUUID(),
            generationId,
            userId,
            `e2e/${generationId}.png`,
            "http://localhost:8888/e2e-generated.png",
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async completeFailure(generationId: string, code: TerminalFailureCode = "provider_timeout") {
      await pool.query(
        `UPDATE generations
         SET status='failed', error_code=$3, error='generation failed', http_status=NULL,
             credits_charged_mp=0, completed_at=now(), updated_at=now()
         WHERE id=$1 AND user_id=$2 AND status IN ('queued','claimed','running')`,
        [generationId, userId, code],
      );
    },
    async removeGeneration(generationId: string) {
      await pool.query("DELETE FROM generations WHERE id=$1 AND user_id=$2", [generationId, userId]);
    },
  };
}

export async function closeKeyModeFixture(): Promise<void> {
  await pool.end();
}
