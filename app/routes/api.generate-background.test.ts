// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../../netlify/functions/generate-background", () => ({ default: mocks.handler }));

import { action } from "./api.generate-background";

const originalDriver = process.env.DISPOSABLE_TEST_DB_DRIVER;

beforeEach(() => {
  process.env.DISPOSABLE_TEST_DB_DRIVER = "pg";
  mocks.handler.mockReset();
});

afterEach(() => {
  if (originalDriver === undefined) delete process.env.DISPOSABLE_TEST_DB_DRIVER;
  else process.env.DISPOSABLE_TEST_DB_DRIVER = originalDriver;
});

describe("local generation background route", () => {
  it("returns 202 without waiting for the detached generation job", async () => {
    let finish: ((response: Response) => void) | undefined;
    mocks.handler.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );

    const response = await action({
      request: new Request("http://localhost:8888/api/generate-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: "00000000-0000-4000-8000-000000000001" }),
      }),
      params: {},
      context: {},
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(202);
    expect(mocks.handler).toHaveBeenCalledOnce();
    finish?.(Response.json({ ok: true }, { status: 202 }));
    await Promise.resolve();
  });

  it("is unavailable outside the disposable test runtime", async () => {
    delete process.env.DISPOSABLE_TEST_DB_DRIVER;

    const response = await action({
      request: new Request("https://site.invalid/api/generate-background", {
        method: "POST",
        body: JSON.stringify({ generationId: "00000000-0000-4000-8000-000000000001" }),
      }),
      params: {},
      context: {},
    } as Parameters<typeof action>[0]);

    expect(response.status).toBe(404);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
