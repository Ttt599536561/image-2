import { createHash, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { loadDisposableTestEnv } from "../../scripts/test-env-guard";
import { closeDbPools } from "../../src/db/db.server";
import { runGenerationJob } from "../../src/server/generation/process";
import { deleteLocalStorageObjects, isLocalStorageEnabled, listLocalStorageObjects } from "../../src/server/local-storage.server";
import type { StudioAccepted, StudioGenerateRequest, StudioStatusBatch } from "../../src/contracts/studio";
import { DEFAULT_STUDIO_BASE_URL, STUDIO_MODEL, type StudioModel } from "../../src/contracts/studio";

const env = loadDisposableTestEnv();
if (!isLocalStorageEnabled() || !env.CUSTOM_KEY_JOB_ENCRYPTION_KEY) {
  throw new Error("[studio-e2e] disposable local storage and encrypted job credentials are required");
}
export const pool = new Pool({ connectionString: env.DATABASE_URL_UNPOOLED, max: 3, allowExitOnIdle: true });
export const fixtureKey = "studio-e2e-fixture-key-never-send-upstream";
// The URL is the production contract, but generation always uses the injected fake relay below.
export const fixtureBaseUrl = DEFAULT_STUDIO_BASE_URL;
export const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
export const referenceFiles = Array.from({ length: 5 }, (_, index) => ({
  name: `reference-${index + 1}.png`, mimeType: "image/png", buffer: Buffer.concat([tinyPng, Buffer.from(`fixture-${index + 1}`)]),
}));
const owners = new Set<string>();
let initialRates: Array<{ bucket_hash: string; hits: number; expires_at: Date }> = [];

test.beforeAll(async () => {
  initialRates = (await pool.query("SELECT * FROM studio_rate_limits")).rows;
});
test.afterEach(async () => {
  // Only remove owners observed through this suite's real browser session cookies.
  const objects = await listLocalStorageObjects();
  const owned = objects.filter(({ key }) => owners.has(key.startsWith("uploads/") ? key.split("/")[1] : key.split("/")[0]));
  expect(await deleteLocalStorageObjects(owned.map(({ key }) => key))).toEqual([]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[...owners]]);
  owners.clear();
});
test.afterAll(async () => {
  // This suite requires exclusive access to the disposable DB, as does test:money.
  await pool.query("DELETE FROM studio_rate_limits WHERE NOT(bucket_hash=ANY($1::text[]))", [initialRates.map((row) => row.bucket_hash)]);
  for (const row of initialRates) await pool.query("INSERT INTO studio_rate_limits(bucket_hash,hits,expires_at) VALUES($1,$2,$3) ON CONFLICT(bucket_hash) DO UPDATE SET hits=excluded.hits,expires_at=excluded.expires_at", [row.bucket_hash, row.hits, row.expires_at]);
  await closeDbPools();
  await pool.end();
});
export { test, expect };

export async function ownerOf(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((item) => item.name === "studio_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  const rows = await pool.query<{ user_id: string }>("SELECT user_id FROM studio_sessions WHERE token_hash=$1", [createHash("sha256").update(cookie!.value).digest("hex")]);
  expect(rows.rowCount).toBe(1);
  const id = rows.rows[0].user_id;
  owners.add(id);
  return id;
}

export async function openStudio(page: Page): Promise<string> {
  const session = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/studio/session");
  await page.goto("/");
  expect((await session).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "让想法成像" })).toBeVisible();
  return ownerOf(page.context());
}

export async function configureConnection(page: Page, remember = false): Promise<void> {
  await page.getByRole("navigation", { name: "工作台导航" }).getByRole("button", { name: "连接设置", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveAttribute("readonly", "");
  await page.getByPlaceholder("输入你的 API Key").fill(fixtureKey);
  await page.getByRole("checkbox", { name: /在此浏览器记住 API Key/ }).setChecked(remember);
  await page.getByRole("button", { name: "完成，开始创作" }).click();
}

export async function selectOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("combobox", { name: label, exact: true })).toContainText(option);
}

export function requestBody(extra: Partial<StudioGenerateRequest> = {}): StudioGenerateRequest {
  return { baseUrl: fixtureBaseUrl, apiKey: fixtureKey, generationId: randomUUID(), prompt: "匿名 Studio 测试作品", size: "1024x1024", quality: "high", background: "opaque", ...extra };
}

export async function postJob(page: Page, body: Record<string, unknown>) {
  return page.request.post("/api/studio/generate", { data: body, headers: { origin: new URL(page.url()).origin, "sec-fetch-site": "same-origin" } });
}

export async function submitFromUi(page: Page, prompt: string): Promise<StudioAccepted> {
  await page.getByLabel("画面描述").fill(prompt);
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/studio/generate" && item.request().method() === "POST");
  await page.getByRole("button", { name: "开始生成" }).click();
  const accepted = await response;
  expect(accepted.status(), await accepted.text()).toBe(202);
  return accepted.json();
}

export async function completeJob(generationId: string, expected: { reference?: boolean; images?: Buffer[]; prompt?: string; model?: StudioModel } = {}): Promise<void> {
  let calls = 0;
  const outcome = await runGenerationJob(generationId, {
    callRelay: async (input) => {
      calls += 1;
      expect(input.credential).toEqual({ mode: "custom", apiKey: fixtureKey, baseUrl: fixtureBaseUrl });
      expect(input.model).toBe(expected.model ?? STUDIO_MODEL);
      if (expected.prompt) expect(input.prompt).toBe(expected.prompt);
      const images = input.inputImages ?? (input.inputImage ? [input.inputImage] : []);
      const expectedImages = expected.images ?? (expected.reference ? [tinyPng] : []);
      expect(images).toHaveLength(expectedImages.length);
      for (const [index, image] of images.entries()) {
        expect(Buffer.from(image.bytes), `reference image ${index + 1}`).toEqual(expectedImages[index]);
        expect(image.contentType).toBe("image/png");
      }
      return { images: [{ b64_json: tinyPng.toString("base64") }] };
    },
  });
  expect(outcome).toBe("succeeded");
  expect(calls).toBe(1);
  expect((await pool.query("SELECT generation_id FROM generation_credentials WHERE generation_id=$1", [generationId])).rowCount).toBe(0);
}

export async function history(page: Page): Promise<Array<{ generationId: string; status: string; blobSize: number; blobType: string; snapshot: string }>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opened = indexedDB.open("image-studio-history", 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const request = db.transaction("generations", "readonly").objectStore("generations").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result.map((entry) => ({ generationId: entry.generationId, status: entry.status, blobSize: entry.blob?.size ?? 0, blobType: entry.blob?.type ?? "", snapshot: JSON.stringify(entry) }))); };
    };
  }));
}

export async function expectNoMoney(ownerId: string): Promise<void> {
  for (const table of ["credit_accounts", "credit_lots", "credit_ledger"]) {
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id=$1`, [ownerId])).rows[0].n, table).toBe(0);
  }
  expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [ownerId])).rowCount).toBe(0);
  expect((await pool.query("SELECT id FROM generations WHERE user_id=$1 AND (credential_mode<>'custom' OR credits_charged_mp<>0)", [ownerId])).rowCount).toBe(0);
}

export async function firstSseStatus(page: Page, generationId: string): Promise<StudioStatusBatch> {
  return page.evaluate((id) => new Promise((resolve, reject) => {
    const source = new EventSource(`/api/studio/events?ids=${id}`);
    const timeout = setTimeout(() => { source.close(); reject(new Error("SSE status timeout")); }, 10_000);
    source.addEventListener("status", (event) => { clearTimeout(timeout); source.close(); resolve(JSON.parse((event as MessageEvent).data)); }, { once: true });
    source.onerror = () => { clearTimeout(timeout); source.close(); reject(new Error("SSE unavailable")); };
  }), generationId);
}
