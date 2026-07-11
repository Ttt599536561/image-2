// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runGenerationJob: vi.fn(),
}));

vi.mock("../../src/server/generation/process", () => ({
  runGenerationJob: mocks.runGenerationJob,
}));

import handler from "../../netlify/functions/generate-background";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generate background handler", () => {
  it("returns and logs only a fixed internal failure when the worker throws", async () => {
    const secret = ["unit", "only", "credential", crypto.randomUUID()].join("-");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runGenerationJob.mockRejectedValue(new Error(`worker failed ${secret}`));

    const response = await handler(
      new Request("http://localhost/.netlify/functions/generate-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: "00000000-0000-4000-8000-000000000001" }),
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(responseText)).toEqual({ error: "internal" });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toHaveLength(1);
    expect(consoleError.mock.calls[0]?.[0]).toBe("[generate-background] internal failure");
    expect(responseText.includes(secret)).toBe(false);
    expect(JSON.stringify(consoleError.mock.calls).includes(secret)).toBe(false);
    expect(JSON.stringify(mocks.runGenerationJob.mock.calls).includes(secret)).toBe(false);

    consoleError.mockRestore();
  });
});
