import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PutResult } from "../../src/server/r2.server";
import { deleteFromR2 } from "../../src/server/r2.server";
import { readLocalStorageObject } from "../../src/server/local-storage.server";
import { encryptCustomApiKey } from "../../src/server/generation/credential.server";
import { runGenerationJob, type ProcessDeps } from "../../src/server/generation/process";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
const apiKey = "fictional-runtime-credential";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

async function createCustom(userId: string): Promise<string> {
  const { generationId } = await ctx.createGeneration(userId, { credentialMode: "custom" });
  const sealed = encryptCustomApiKey(generationId, apiKey);
  await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                VALUES(${generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},${sealed.keyVersion},now()+interval '10 minutes')`;
  return generationId;
}

const storage = async (_userId: string, generationId: string): Promise<PutResult> => ({
  storageKey: `mtest/${generationId}.png`,
  publicUrl: `https://img.test/${generationId}.png`,
  contentType: "image/png",
  width: 1,
  height: 1,
  sizeBytes: 70,
});

describe("custom generation pipeline", () => {
  it("succeeds with zero charge, no debit, and deletes the credential", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    const generationId = await createCustom(userId);
    const callRelay = vi.fn(async (request: Parameters<NonNullable<ProcessDeps["callRelay"]>>[0]) => {
      expect(request.credential).toEqual({ mode: "custom", apiKey });
      expect(request.deadlineAt).toBeInstanceOf(Date);
      return { images: [{ b64_json: "aGVsbG8=" }] };
    });

    expect(await runGenerationJob(generationId, { callRelay, putToR2: storage })).toBe("succeeded");
    expect(Number((await ctx.gen(generationId))?.credits_charged_mp)).toBe(0);
    expect(await ctx.balanceMp(userId)).toBe(0);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);
    expect(await ctx.images(generationId)).toHaveLength(1);
    expect(await ctx.credentials(generationId)).toHaveLength(0);
    expect(await runGenerationJob(generationId, { callRelay, putToR2: storage })).toBe("lost");
    expect(callRelay).toHaveBeenCalledOnce();
  });

  it("persists a successful custom image in disposable local storage", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    const generationId = await createCustom(userId);

    expect(
      await runGenerationJob(generationId, {
        callRelay: async () => ({ images: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] }),
      }),
    ).toBe("succeeded");

    const [image] = await ctx.images(generationId);
    expect(image.public_url).toContain("/media/");
    const stored = await readLocalStorageObject(String(image.storage_key));
    expect(Buffer.from(stored.bytes)).toEqual(ONE_PIXEL_PNG);
    await deleteFromR2(String(image.storage_key));
  });

  it("never falls back to system when the custom credential fails", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    const generationId = await createCustom(userId);
    const callRelay: ProcessDeps["callRelay"] = async (request) => {
      expect(request.credential?.mode).toBe("custom");
      throw Object.assign(new Error(`401 echoed ${apiKey}`), { httpStatus: 401 });
    };

    expect(await runGenerationJob(generationId, { callRelay })).toBe("failed");
    const generation = await ctx.gen(generationId);
    expect(generation?.error_code).toBe("custom_key_invalid");
    expect(String(generation?.error)).not.toContain(apiKey);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);
    expect(await ctx.credentials(generationId)).toHaveLength(0);
  });

  it("runs custom image edits through the shared relay and still charges zero", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    const generationId = await createCustom(userId);
    const inputImageKey = `uploads/${userId}/ref.png`;
    await ctx.sql`UPDATE generations SET input_image_key=${inputImageKey} WHERE id=${generationId}`;

    const outcome = await runGenerationJob(generationId, {
      getUploadObject: async (key) => {
        expect(key).toBe(inputImageKey);
        return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" };
      },
      callRelay: async (request) => {
        expect(request.inputImage).toBeTruthy();
        expect(request.credential).toEqual({ mode: "custom", apiKey });
        return { images: [{ b64_json: "aGVsbG8=" }] };
      },
      putToR2: storage,
    });
    expect(outcome).toBe("succeeded");
    expect(await ctx.balanceMp(userId)).toBe(0);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);
  });

  it.each([
    ["invalid_response", async () => ({ images: [] })],
    ["storage_failed", async () => ({ images: [{ b64_json: "aGVsbG8=" }] })],
  ] as const)("stores the precise %s code without charging", async (expectedCode, relay) => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    const generationId = await createCustom(userId);
    const putToR2 = expectedCode === "storage_failed" ? async () => Promise.reject(new Error("storage")) : storage;
    const outcome = await runGenerationJob(generationId, { callRelay: relay, putToR2 });
    expect(outcome).toBe("failed");
    expect((await ctx.gen(generationId))?.error_code).toBe(expectedCode);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);
    expect(await ctx.credentials(generationId)).toHaveLength(0);
  });
});
