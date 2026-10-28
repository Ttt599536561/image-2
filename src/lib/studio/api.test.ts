import { afterEach, describe, expect, it, vi } from "vitest";
import { submitGeneration, validateReferenceImage } from "./api";
import type { StudioGenerateRequest } from "../../contracts/studio";

afterEach(() => vi.unstubAllGlobals());
describe("anonymous studio requests", () => {
  it("reuses the provided id on manual network retry and never automatically resubmits", async () => {
    const bodies: StudioGenerateRequest[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) throw new TypeError("network lost");
      return Response.json({ generationId: bodies[1].generationId, status: "queued", conversationId: "conversation", deadlineAt: "date" }, { status: 202 });
    });
    const request: StudioGenerateRequest = { generationId: "f10c8523-20ee-45b0-8f2e-52a88dfdbe20", prompt: "a cat", size: "auto", baseUrl: "https://example.com/v1", apiKey: "fixture" };
    await expect(submitGeneration(request)).rejects.toThrow();
    expect(bodies).toHaveLength(1);
    await submitGeneration(request);
    expect(bodies[1].generationId).toBe(bodies[0].generationId);
  });
  it("rejects unsupported and oversized reference files before uploading", () => {
    expect(validateReferenceImage(new File(["image"], "x.gif", { type: "image/gif" }))).toMatch(/PNG/);
    expect(validateReferenceImage(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "x.png", { type: "image/png" }))).toMatch(/4 MiB/);
    expect(validateReferenceImage(new File(["image"], "x.webp", { type: "image/webp" }))).toBeNull();
  });
});
