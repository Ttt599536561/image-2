import { describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_BASE_URL, StudioGenerateRequest } from "./studio";

const request = { apiKey: "fictional-key", prompt: "tree", size: "1024x1024", generationId: "00000000-0000-4000-8000-000000000001" };
describe("studio generation contract", () => {
  it("accepts a key-only connection and defaults the model", () => {
    expect(StudioGenerateRequest.parse(request).model).toBe("gpt-image-2");
    expect(StudioGenerateRequest.parse({ ...request, baseUrl: DEFAULT_STUDIO_BASE_URL }).baseUrl).toBe(DEFAULT_STUDIO_BASE_URL);
  });
  it.each(["https://evil.example/v1", "http://api.tangguo.xin/v1", "https://api.tangguo.xin/v1/else", "https://api.tangguo.xin.evil.example/v1"])("rejects a substituted upstream %s", (baseUrl) => {
    expect(StudioGenerateRequest.safeParse({ ...request, baseUrl }).success).toBe(false);
  });
  it.each(["gpt-image-2", "gpt-image-2.5-sunburst"])("accepts model %s", (model) => {
    expect(StudioGenerateRequest.parse({ ...request, model }).model).toBe(model);
  });
  it("accepts four ordered references and legacy single reference", () => {
    const inputImageKeys = ["one", "two", "three", "four"];
    expect(StudioGenerateRequest.parse({ ...request, inputImageKeys }).inputImageKeys).toEqual(inputImageKeys);
    expect(StudioGenerateRequest.parse({ ...request, inputImageKey: "legacy" }).inputImageKey).toBe("legacy");
  });
  it.each([
    { model: "unsupported" }, { inputImageKeys: [] }, { inputImageKeys: ["1", "2", "3", "4", "5"] },
    { inputImageKeys: [""] }, { inputImageKeys: ["1"], inputImageKey: "old" },
    { inputImageKeys: ["1"], sourceImageId: request.generationId },
    { inputImageKey: "old", sourceImageId: request.generationId },
  ])("rejects invalid models and conflicting references %j", (fields) => {
    expect(StudioGenerateRequest.safeParse({ ...request, ...fields }).success).toBe(false);
  });
});
