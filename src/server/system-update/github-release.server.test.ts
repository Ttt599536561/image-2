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

  it("falls back to the tag and empty text for nullable name and body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(githubRelease({ name: null, body: null })));

    const result = await checkLatestStableRelease({ currentVersion: "1.2.2", fetchImpl });

    expect(result.release).toMatchObject({ name: "v1.2.3", summary: "" });
  });
});
