import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestCtx, newCtx } from "./_helpers";

let ctx: TestCtx;

beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("key mode schema", () => {
  it("defaults generations to system and creates a five minute deadline", async () => {
    const userId = await ctx.createUser();
    const conversationId = randomUUID();
    const generationId = randomUUID();
    await ctx.sql`INSERT INTO conversations(id,user_id,title) VALUES(${conversationId},${userId},'schema default')`;
    await ctx.sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size)
                  VALUES(${generationId},${conversationId},${userId},'default probe','auto')`;

    const generation = await ctx.gen(generationId);
    expect(generation?.credential_mode).toBe("system");
    expect(Date.parse(String(generation?.deadline_at)) - Date.parse(String(generation?.created_at))).toBe(300_000);
  });

  it("stores only encrypted credential material and cascades on generation delete", async () => {
    const userId = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(userId, { credentialMode: "custom" });
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${generationId},'cipher-b64','iv-b64','tag-b64',1,now()+interval '10 minutes')`;
    expect(await ctx.credentials(generationId)).toHaveLength(1);
    await ctx.sql`DELETE FROM generations WHERE id=${generationId}`;
    expect(await ctx.credentials(generationId)).toHaveLength(0);
  });
});
