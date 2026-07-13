// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeFailure } from "./failure";

const error = (message: string, httpStatus?: number) => Object.assign(new Error(message), { httpStatus });

describe("mode-aware failure mapping", () => {
  it("preserves the stable source image unavailable failure", () => {
    expect(
      normalizeFailure(
        Object.assign(new Error("这张图片已不可编辑"), {
          failureCode: "source_image_unavailable" as const,
        }),
        { mode: "system", secrets: [] },
      ),
    ).toMatchObject({ code: "source_image_unavailable", message: "这张图片已不可编辑" });
  });

  it.each([
    ["custom", error("bad credentials", 401), "custom_key_invalid"],
    ["custom", error("insufficient_quota", 402), "custom_key_quota"],
    ["custom", error("billing quota exhausted", 403), "custom_key_quota"],
    ["custom", error("too many requests", 429), "relay_rate_limited"],
    ["custom", error("content_policy", 403), "content_rejected"],
    ["custom", error("invalid size", 400), "invalid_request"],
    ["custom", error("gateway unavailable", 503), "relay_unreachable"],
    ["system", error("insufficient_quota", 402), "insufficient_quota"],
    ["system", error("too many requests", 429), "relay_5xx"],
    ["system", error("gateway unavailable", 503), "relay_5xx"],
  ] as const)("maps %s provider errors without changing system semantics", (mode, providerError, code) => {
    expect(normalizeFailure(providerError, { mode, secrets: ["fictional-secret"] }).code).toBe(code);
  });

  it("redacts the actual custom key before returning a message", () => {
    const result = normalizeFailure(error("echo fictional-secret", 401), {
      mode: "custom",
      secrets: ["fictional-secret"],
    });
    expect(result.message).not.toContain("fictional-secret");
  });

  it("keeps custom-only internal failure codes out of system rows", () => {
    const malformed = Object.assign(new Error("bad response"), { failureCode: "invalid_response" as const });
    const storage = Object.assign(new Error("storage unavailable"), { failureCode: "storage_failed" as const });
    expect(normalizeFailure(malformed, { mode: "system", secrets: [] }).code).toBe("unknown");
    expect(normalizeFailure(storage, { mode: "system", secrets: [] }).code).toBe("unknown");
  });
});
