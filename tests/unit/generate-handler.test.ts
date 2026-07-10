// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserStrict: vi.fn(),
  enqueueGeneration: vi.fn(),
  triggerBackground: vi.fn(),
}));

vi.mock("../../src/lib/guard", () => ({ requireUserStrict: mocks.requireUserStrict }));
vi.mock("../../src/server/generation/enqueue", () => ({ enqueueGeneration: mocks.enqueueGeneration }));
vi.mock("../../src/server/generation/trigger", () => ({ triggerBackground: mocks.triggerBackground }));

import handler from "../../netlify/functions/generate";

const base = { prompt: "unit prompt", size: "auto" };
const originalFlag = process.env.CUSTOM_KEY_MODES_ENABLED;

async function body(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

beforeEach(() => {
  delete process.env.CUSTOM_KEY_MODES_ENABLED;
  vi.clearAllMocks();
  mocks.requireUserStrict.mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000001", maxConcurrency: 2 });
  mocks.enqueueGeneration.mockResolvedValue({
    generationId: "00000000-0000-4000-8000-000000000002",
    conversationId: "00000000-0000-4000-8000-000000000003",
    credentialMode: "system",
    deadlineAt: "2026-07-11T00:05:00.000Z",
  });
  mocks.triggerBackground.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.CUSTOM_KEY_MODES_ENABLED;
  else process.env.CUSTOM_KEY_MODES_ENABLED = originalFlag;
});

describe("POST /api/generate handler", () => {
  it("returns INVALID_PARAM for malformed JSON without enqueueing", async () => {
    const response = await handler(
      new Request("http://localhost/api/generate", { method: "POST", body: "{" }),
    );
    expect(response.status).toBe(400);
    expect((await body(response)).error.code).toBe("INVALID_PARAM");
    expect(mocks.enqueueGeneration).not.toHaveBeenCalled();
  });

  it("maps credential contract failures to stable API error codes", async () => {
    const missing = await handler(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, credentialMode: "custom" }),
      }),
    );
    expect(missing.status).toBe(400);
    expect((await body(missing)).error.code).toBe("CUSTOM_KEY_REQUIRED");

    const forbidden = await handler(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, credentialMode: "system", customApiKey: "fictional-forbidden" }),
      }),
    );
    expect(forbidden.status).toBe(400);
    expect((await body(forbidden)).error.code).toBe("SYSTEM_MODE_FORBIDS_CUSTOM_KEY");
    expect(mocks.enqueueGeneration).not.toHaveBeenCalled();
  });

  it.each([undefined, "false"])("keeps custom mode unavailable when the flag is %s", async (flag) => {
    if (flag === undefined) delete process.env.CUSTOM_KEY_MODES_ENABLED;
    else process.env.CUSTOM_KEY_MODES_ENABLED = flag;
    const response = await handler(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, credentialMode: "custom", customApiKey: "fictional-paused" }),
      }),
    );
    expect(response.status).toBe(503);
    expect((await body(response)).error.code).toBe("CUSTOM_KEY_MODES_DISABLED");
    expect(mocks.enqueueGeneration).not.toHaveBeenCalled();
    expect(mocks.triggerBackground).not.toHaveBeenCalled();
  });

  it("accepts custom only when explicitly enabled and returns the authoritative fields", async () => {
    process.env.CUSTOM_KEY_MODES_ENABLED = "true";
    mocks.enqueueGeneration.mockResolvedValueOnce({
      generationId: "00000000-0000-4000-8000-000000000004",
      conversationId: "00000000-0000-4000-8000-000000000005",
      credentialMode: "custom",
      deadlineAt: "2026-07-11T00:05:00.000Z",
    });
    const response = await handler(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, credentialMode: "custom", customApiKey: "fictional-enabled" }),
      }),
    );
    expect(response.status).toBe(202);
    expect(await body(response)).toEqual({
      generationId: "00000000-0000-4000-8000-000000000004",
      conversationId: "00000000-0000-4000-8000-000000000005",
      status: "queued",
      credentialMode: "custom",
      deadlineAt: "2026-07-11T00:05:00.000Z",
    });
    expect(mocks.enqueueGeneration).toHaveBeenCalledWith({
      user: { id: "00000000-0000-4000-8000-000000000001", maxConcurrency: 2 },
      input: { ...base, credentialMode: "custom", customApiKey: "fictional-enabled" },
    });
    expect(mocks.triggerBackground).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
  });

  it("keeps explicit system requests on the existing enqueue and trigger path", async () => {
    const response = await handler(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, credentialMode: "system" }),
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.enqueueGeneration).toHaveBeenCalledWith({
      user: { id: "00000000-0000-4000-8000-000000000001", maxConcurrency: 2 },
      input: { ...base, credentialMode: "system" },
    });
    expect(mocks.triggerBackground).toHaveBeenCalledTimes(1);
  });
});
