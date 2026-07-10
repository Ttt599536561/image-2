import { describe, expect, it } from "vitest";
import {
  GenerateAcceptedResponse,
  GenerateRequest,
  generateRequestErrorCode,
  type GenerateParams,
} from "./generate";

const params: GenerateParams = {
  prompt: "a rainy city",
  size: "1024x1024",
  quality: "auto",
  background: "auto",
};

describe("GenerateRequest credential modes", () => {
  it("keeps old requests compatible by defaulting to system", () => {
    expect(GenerateRequest.parse(params)).toEqual({ ...params, credentialMode: "system" });
  });

  it("accepts an explicit system request without a custom key", () => {
    expect(GenerateRequest.parse({ ...params, credentialMode: "system" }).credentialMode).toBe("system");
  });

  it("accepts custom mode and trims its key", () => {
    const parsed = GenerateRequest.parse({
      ...params,
      credentialMode: "custom",
      customApiKey: "  fictional-custom-key  ",
    });
    expect(parsed).toMatchObject({ credentialMode: "custom", customApiKey: "fictional-custom-key" });
  });

  it("returns a stable error code when custom mode has no usable key", () => {
    for (const customApiKey of [undefined, "   "]) {
      const result = GenerateRequest.safeParse({ ...params, credentialMode: "custom", customApiKey });
      expect(result.success).toBe(false);
      if (!result.success) expect(generateRequestErrorCode(result.error)).toBe("CUSTOM_KEY_REQUIRED");
    }
  });

  it("returns a stable error code when system or a legacy request carries a custom key", () => {
    for (const value of [
      { ...params, credentialMode: "system", customApiKey: "fictional-key" },
      { ...params, customApiKey: "fictional-key" },
    ]) {
      const result = GenerateRequest.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(generateRequestErrorCode(result.error)).toBe("SYSTEM_MODE_FORBIDS_CUSTOM_KEY");
      }
    }
  });

  it("rejects custom keys longer than 500 characters", () => {
    const result = GenerateRequest.safeParse({
      ...params,
      credentialMode: "custom",
      customApiKey: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a client supplied relay URL", () => {
    const result = GenerateRequest.safeParse({
      ...params,
      credentialMode: "custom",
      customApiKey: "fictional-key",
      customBaseUrl: "https://invalid.example/v1",
    });
    expect(result.success).toBe(false);
  });
});

describe("GenerateAcceptedResponse", () => {
  it("requires the authoritative mode and deadline", () => {
    const accepted = {
      generationId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      status: "queued",
      credentialMode: "custom",
      deadlineAt: "2026-07-11T12:05:00.000Z",
    };
    expect(GenerateAcceptedResponse.parse(accepted)).toEqual(accepted);
    expect(GenerateAcceptedResponse.safeParse({
      generationId: accepted.generationId,
      conversationId: accepted.conversationId,
      status: "queued",
    }).success).toBe(false);
  });
});
