// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkLatestStableRelease,
  GitHubReleaseError,
  type GitHubReleaseErrorCode,
  resetReleaseCacheForTests,
} from "./github-release.server";

const endpoint = "https://api.github.com/repos/Ttt599536561/image-2/releases/latest";
const publishedAt = "2026-07-12T00:00:00Z";
const maxResponseBytes = 1024 * 1024;

function githubRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v1.2.3",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/Ttt599536561/image-2/releases/tag/v1.2.3",
    published_at: publishedAt,
    name: "Version 1.2.3",
    body: "Release notes",
    ...overrides,
  };
}

function jsonResponse(
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cancelableResponse(
  status: number,
  headers: Record<string, string> = {},
  cancelImpl: () => void | Promise<void> = () => undefined,
) {
  const cancel = vi.fn(() => cancelImpl());
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
    },
    cancel,
  });
  return { response: new Response(body, { status, headers }), cancel };
}

function trackSettlement(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

async function expectReleaseError(
  promise: Promise<unknown>,
  code: GitHubReleaseErrorCode,
) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GitHubReleaseError);
  expect(error).toMatchObject({ name: "GitHubReleaseError", code });
  return error as GitHubReleaseError;
}

beforeEach(() => {
  resetReleaseCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkLatestStableRelease", () => {
  it("fetches the fixed official endpoint and returns an available stable release", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...githubRelease(),
        id: 123,
        author: { login: "release-bot" },
        assets: [],
      }),
    );

    const result = await checkLatestStableRelease({
      currentVersion: "1.2.2",
      fetchImpl,
    });

    expect(result).toEqual({
      state: "available",
      release: {
        tag: "v1.2.3",
        version: "1.2.3",
        name: "Version 1.2.3",
        summary: "Release notes",
        htmlUrl: "https://github.com/Ttt599536561/image-2/releases/tag/v1.2.3",
        publishedAt,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-image-workshop-system-updater",
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(8_000);
  });

  it("returns none for a 404 response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
    ).resolves.toEqual({ state: "none", release: null });
  });

  it("waits for best-effort body cancellation before caching a 404", async () => {
    const order: string[] = [];
    const { response, cancel } = cancelableResponse(
      404,
      {},
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("cancelled");
            resolve();
          }, 0);
        }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    const result = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    order.push("returned");

    expect(result).toEqual({ state: "none", release: null });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancelled", "returned"]);
  });

  it.each([
    ["draft", { draft: true }],
    ["prerelease", { prerelease: true }],
  ])("ignores a %s response", async (_label, overrides) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease(overrides)));

    await expect(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
    ).resolves.toEqual({ state: "none", release: null });
  });

  it.each([
    "https://github.com/SomeoneElse/image-2/releases/tag/v1.2.3",
    "https://github.com/Ttt599536561/another-repo/releases/tag/v1.2.3",
    "https://github.com/Ttt599536561/image-2/releases/tag/v9.9.9",
  ])("rejects mismatched release URL %s", async (htmlUrl) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease({ html_url: htmlUrl })));

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "repository_mismatch",
    );
  });

  it.each(["1.2.3", "v1.2.3-beta.1", "v01.2.3", "v1.2"]) (
    "rejects malformed stable tag %s",
    async (tag) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(githubRelease({ tag_name: tag })));

      await expectReleaseError(
        checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
        "malformed_response",
      );
    },
  );

  it("rejects malformed JSON without leaking parser details", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
    expect(error.message).not.toContain("not-json");
    expect(error.message).not.toContain("Unexpected");
  });

  it("rejects a malformed GitHub response shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(githubRelease({ published_at: 42 })),
    );

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
  });

  it.each([
    ["1.2.3", "v1.2.3"],
    ["2.0.0", "v1.2.3"],
  ])("returns up_to_date when current %s is not below target %s", async (currentVersion, tag) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        githubRelease({
          tag_name: tag,
          html_url: `https://github.com/Ttt599536561/image-2/releases/tag/${tag}`,
        }),
      ),
    );

    const result = await checkLatestStableRelease({ currentVersion, fetchImpl });

    expect(result.state).toBe("up_to_date");
    expect(result.release?.version).toBe("1.2.3");
  });

  it("converts abort failures into a sanitized timeout error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("remote abort detail", "AbortError"));

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "timeout",
    );
    expect(error.message).not.toContain("remote abort detail");
  });

  it("converts AbortSignal timeout failures into a sanitized timeout error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("remote timeout detail", "TimeoutError"));

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "timeout",
    );
    expect(error.message).not.toContain("remote timeout detail");
  });

  it.each([
    [429, {}],
    [403, { "x-ratelimit-remaining": "0" }],
    [403, { "retry-after": "60" }],
  ])("classifies HTTP %i rate-limit responses", async (status, headers) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("remote secret and quota details", { status, headers }),
    );

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "rate_limit",
    );
    expect(error.message).not.toContain("remote secret");
  });

  it("keeps an unrelated HTTP 403 classified as an HTTP failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("forbidden detail", { status: 403 }));

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "http_failure",
    );
  });

  it("classifies other non-success HTTP responses without exposing their body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private upstream detail", { status: 500 }));

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "http_failure",
    );
    expect(error.message).not.toContain("private upstream detail");
  });

  it("cancels a rate-limit response body while preserving the rate-limit error", async () => {
    const { response, cancel } = cancelableResponse(429, {}, () =>
      Promise.reject(new Error("cancel failure")),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "rate_limit",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels another non-success response body before returning the HTTP error", async () => {
    const { response, cancel } = cancelableResponse(500);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "http_failure",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("sanitizes non-abort fetch failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network secret"));

    const error = await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "network_failure",
    );
    expect(error.message).not.toContain("network secret");
  });

  it("revalidates stale ETag cache entries and refreshes them on 304", async () => {
    let time = 1_000;
    const now = () => time;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease(), { headers: { etag: '"release-1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    const first = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl, now });
    time += 5 * 60 * 1_000 + 1;
    const revalidated = await checkLatestStableRelease({
      currentVersion: "1.2.2",
      fetchImpl,
      now,
    });
    time += 1;
    const freshAgain = await checkLatestStableRelease({
      currentVersion: "1.2.2",
      fetchImpl,
      now,
    });

    expect(revalidated).toEqual(first);
    expect(freshAgain).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      "If-None-Match": '"release-1"',
    });
  });

  it("rejects a 304 response when no cached result exists", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 304 }));

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
  });

  it("rejects a 304 response when the cached result has no ETag", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease()))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", force: true, fetchImpl }),
      "malformed_response",
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).not.toMatchObject({
      "If-None-Match": expect.anything(),
    });
  });

  it("uses a fresh five-minute cache entry without fetching again", async () => {
    let time = 10_000;
    const now = () => time;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(githubRelease()));

    const first = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl, now });
    time += 5 * 60 * 1_000 - 1;
    const second = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl, now });

    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cold checks for the same currentVersion", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => response.promise);

    const first = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    const second = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    const firstSettled = trackSettlement(first);
    const secondSettled = trackSettlement(second);
    await Promise.resolve();
    const bothPending = !firstSettled() && !secondSettled();
    const fetchCalls = fetchImpl.mock.calls.length;
    response.resolve(jsonResponse(githubRelease()));
    const settled = await Promise.allSettled([first, second]);

    expect(bothPending).toBe(true);
    expect(fetchCalls).toBe(1);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    if (settled[0]?.status === "fulfilled" && settled[1]?.status === "fulfilled") {
      expect(settled[0].value).toEqual(settled[1].value);
      expect(settled[0].value.state).toBe("available");
    }
  });

  it("coalesces concurrent stale and force revalidations for the same currentVersion", async () => {
    let time = 1_000;
    const now = () => time;
    const response = deferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease(), { headers: { etag: '"release-1"' } }))
      .mockImplementationOnce(() => response.promise);

    await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl, now });
    time += 5 * 60 * 1_000 + 1;
    const stale = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl, now });
    const forced = checkLatestStableRelease({
      currentVersion: "1.2.2",
      force: true,
      fetchImpl,
      now,
    });
    const forcedAgain = checkLatestStableRelease({
      currentVersion: "1.2.2",
      force: true,
      fetchImpl,
      now,
    });

    const staleSettled = trackSettlement(stale);
    const forcedSettled = trackSettlement(forced);
    const forcedAgainSettled = trackSettlement(forcedAgain);
    await Promise.resolve();
    const allPending = !staleSettled() && !forcedSettled() && !forcedAgainSettled();
    const fetchCalls = fetchImpl.mock.calls.length;
    response.resolve(new Response(null, { status: 304 }));
    const settled = await Promise.allSettled([stale, forced, forcedAgain]);

    expect(allPending).toBe(true);
    expect(fetchCalls).toBe(2);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
    if (
      settled[0]?.status === "fulfilled" &&
      settled[1]?.status === "fulfilled" &&
      settled[2]?.status === "fulfilled"
    ) {
      expect(settled[1].value).toEqual(settled[0].value);
      expect(settled[2].value).toEqual(settled[0].value);
    }
  });

  it("runs concurrent checks for different currentVersion keys independently", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);

    const first = checkLatestStableRelease({ currentVersion: "1.2.1", fetchImpl });
    const second = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    const firstSettled = trackSettlement(first);
    const secondSettled = trackSettlement(second);
    await Promise.resolve();
    const bothPending = !firstSettled() && !secondSettled();
    const fetchCalls = fetchImpl.mock.calls.length;
    firstResponse.resolve(jsonResponse(githubRelease()));
    secondResponse.resolve(jsonResponse(githubRelease()));
    const settled = await Promise.allSettled([first, second]);

    expect(bothPending).toBe(true);
    expect(fetchCalls).toBe(2);
    expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("removes a failed in-flight check so a later call retries", async () => {
    const failedResponse = deferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => failedResponse.promise)
      .mockImplementation(() => Promise.resolve(jsonResponse(githubRelease())));

    const first = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    const second = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    const firstSettled = trackSettlement(first);
    const secondSettled = trackSettlement(second);
    await Promise.resolve();
    const bothPending = !firstSettled() && !secondSettled();
    const fetchCallsBeforeFailure = fetchImpl.mock.calls.length;
    failedResponse.reject(new TypeError("network failure"));
    const settled = await Promise.allSettled([first, second]);

    await expect(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
    ).resolves.toMatchObject({ state: "available" });
    expect(bothPending).toBe(true);
    expect(fetchCallsBeforeFailure).toBe(1);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prevents a pre-reset request from overwriting the post-reset cache", async () => {
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    const oldRelease = githubRelease({
      tag_name: "v1.3.0",
      html_url: "https://github.com/Ttt599536561/image-2/releases/tag/v1.3.0",
    });
    const newRelease = githubRelease({
      tag_name: "v1.4.0",
      html_url: "https://github.com/Ttt599536561/image-2/releases/tag/v1.4.0",
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => newResponse.promise)
      .mockImplementation(() => Promise.resolve(jsonResponse(newRelease)));

    const oldCheck = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    resetReleaseCacheForTests();
    const newCheck = checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    newResponse.resolve(jsonResponse(newRelease));
    const newResult = await newCheck;
    oldResponse.resolve(jsonResponse(oldRelease));
    const oldResult = await oldCheck;
    const cachedResult = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    expect(newResult.release?.version).toBe("1.4.0");
    expect(oldResult.release?.version).toBe("1.3.0");
    expect(cachedResult.release?.version).toBe("1.4.0");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("force bypasses freshness and conditionally revalidates with the cached ETag", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease(), { headers: { etag: '"release-1"' } }))
      .mockResolvedValueOnce(
        jsonResponse(
          githubRelease({
            tag_name: "v1.3.0",
            html_url: "https://github.com/Ttt599536561/image-2/releases/tag/v1.3.0",
          }),
          { headers: { etag: '"release-2"' } },
        ),
      );

    await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    const forced = await checkLatestStableRelease({
      currentVersion: "1.2.2",
      force: true,
      fetchImpl,
    });

    expect(forced.release?.version).toBe("1.3.0");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      "If-None-Match": '"release-1"',
    });
  });

  it("keys the release cache by currentVersion", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease()))
      .mockResolvedValueOnce(jsonResponse(githubRelease()));

    await checkLatestStableRelease({ currentVersion: "1.2.1", fetchImpl });
    await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).not.toMatchObject({
      "If-None-Match": expect.anything(),
    });
  });

  it("validates currentVersion before invoking fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "v1.2.2", fetchImpl }),
      "invalid_current_version",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a response whose declared Content-Length exceeds 1 MiB", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(maxResponseBytes + 1) },
      }),
    );

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
  });

  it("cancels the response body before rejecting an oversized declared Content-Length", async () => {
    const { response, cancel } = cancelableResponse(200, {
      "content-length": String(maxResponseBytes + 1),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", undefined],
    ["lying", "16"],
  ])("enforces the 1 MiB cap while reading a %s Content-Length response", async (_label, length) => {
    const oversizedJson = JSON.stringify(
      githubRelease({ body: "x".repeat(maxResponseBytes) }),
    );
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (length !== undefined) headers["content-length"] = length;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(oversizedJson, { status: 200, headers }));

    await expectReleaseError(
      checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl }),
      "malformed_response",
    );
  });

  it("keeps the release body as plain text and truncates it to 1,000 characters", async () => {
    const body = "<script>alert('plain text')</script>\n**markdown**\n" + "x".repeat(1_100);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease({ body })));

    const result = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    expect(result.release?.summary).toBe(body.slice(0, 1_000));
    expect(result.release?.summary).toContain("<script>");
    expect(result.release?.summary).toContain("**markdown**");
  });

  it("does not leave a dangling high surrogate when truncation splits an emoji", async () => {
    const body = "x".repeat(999) + "\u{1F600}" + "tail";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease({ body })));

    const result = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });
    const summary = result.release?.summary ?? "";
    const finalCodeUnit = summary.charCodeAt(summary.length - 1);

    expect(summary).toBe("x".repeat(999));
    expect(summary.length).toBeLessThanOrEqual(1_000);
    expect(finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff).toBe(false);
  });

  it("falls back to the tag and empty text for nullable name and body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease({ name: null, body: null })));

    const result = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    expect(result.release).toMatchObject({ name: "v1.2.3", summary: "" });
  });
});
