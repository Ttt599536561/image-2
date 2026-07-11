// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureException,
  captureMessage,
  installSentryTestClient,
} from "./sentry.server";

const testSecret = () => ["unit", "only", "credential", crypto.randomUUID()].join("-");

describe("Sentry observation redaction", () => {
  let restoreClient: (() => void) | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreClient?.();
    restoreClient = undefined;
    vi.restoreAllMocks();
  });

  it("redacts exception messages and nested context before console and the real sink call", async () => {
    const secret = testSecret();
    const captureExceptionSink = vi.fn();
    const captureMessageSink = vi.fn();
    restoreClient = installSentryTestClient({
      captureException: captureExceptionSink,
      captureMessage: captureMessageSink,
    });

    const error = new Error(`provider rejected ${secret}`);
    error.name = "ProviderError";
    await captureException(
      error,
      { relay: { authorization: `Bearer ${secret}`, detail: secret } },
      [secret],
    );

    expect(captureExceptionSink).toHaveBeenCalledTimes(1);
    const observedError = captureExceptionSink.mock.calls[0]?.[0];
    expect(observedError).toBeInstanceOf(Error);
    expect((observedError as Error).name).toBe("ProviderError");
    expect((observedError as Error).message.includes(secret)).toBe(false);
    expect(JSON.stringify(captureExceptionSink.mock.calls).includes(secret)).toBe(false);
    expect(JSON.stringify(consoleError.mock.calls).includes(secret)).toBe(false);
  });

  it("redacts messages, nested context, and sink failures before observation", async () => {
    const secret = testSecret();
    const captureExceptionSink = vi.fn();
    const captureMessageSink = vi.fn(() => {
      throw new Error(`sink failed ${secret}`);
    });
    restoreClient = installSentryTestClient({
      captureException: captureExceptionSink,
      captureMessage: captureMessageSink,
    });

    await captureMessage(
      `relay warning ${secret}`,
      "warning",
      { nested: { token: secret } },
      [secret],
    );

    expect(captureMessageSink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captureMessageSink.mock.calls).includes(secret)).toBe(false);
    expect(JSON.stringify(consoleWarn.mock.calls).includes(secret)).toBe(false);
    expect(JSON.stringify(consoleError.mock.calls).includes(secret)).toBe(false);
  });
});
