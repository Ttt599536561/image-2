import { z } from "zod";
import { StableRelease, StableVersion } from "../../contracts/system-update";
import { isStableUpgrade, versionFromStableTag } from "./semver";

const GITHUB_OWNER = "Ttt599536561";
const GITHUB_REPOSITORY = "image-2";
const GITHUB_RELEASE_ENDPOINT =
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`;
const EXPECTED_RELEASE_URL_PREFIX =
  `https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/tag/`;
const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "ai-image-workshop-system-updater";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SUMMARY_CHARACTERS = 1_000;

const GitHubReleasePayload = z
  .object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    html_url: z.string(),
    published_at: z.iso.datetime(),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
  })
  .strict();

type GitHubReleasePayload = z.infer<typeof GitHubReleasePayload>;
type StableReleaseValue = z.infer<typeof StableRelease>;

export const GITHUB_RELEASE_ERROR_CODES = [
  "timeout",
  "rate_limit",
  "malformed_response",
  "repository_mismatch",
  "http_failure",
  "network_failure",
  "invalid_current_version",
] as const;

export type GitHubReleaseErrorCode = (typeof GITHUB_RELEASE_ERROR_CODES)[number];

const ERROR_MESSAGES: Record<GitHubReleaseErrorCode, string> = {
  timeout: "Official GitHub release check timed out.",
  rate_limit: "Official GitHub release API rate limit exceeded.",
  malformed_response: "Official GitHub release response was malformed.",
  repository_mismatch: "GitHub release did not match the official repository.",
  http_failure: "Official GitHub release check failed.",
  network_failure: "Official GitHub release service was unavailable.",
  invalid_current_version: "Current build version is invalid.",
};

export class GitHubReleaseError extends Error {
  readonly code: GitHubReleaseErrorCode;

  constructor(code: GitHubReleaseErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GitHubReleaseError";
    this.code = code;
  }
}

export type CheckLatestStableReleaseOptions = {
  currentVersion: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type LatestStableReleaseResult =
  | { state: "none"; release: null }
  | { state: "up_to_date" | "available"; release: StableReleaseValue };

type CachedReleaseResult = {
  value: LatestStableReleaseResult;
  etag: string | null;
  checkedAt: number;
};

const releaseCache = new Map<string, CachedReleaseResult>();
const inFlightReleaseChecks = new Map<string, Promise<LatestStableReleaseResult>>();

export function resetReleaseCacheForTests(): void {
  releaseCache.clear();
  inFlightReleaseChecks.clear();
}

function error(code: GitHubReleaseErrorCode): GitHubReleaseError {
  return new GitHubReleaseError(code);
}

function isTimeoutOrAbortError(cause: unknown): boolean {
  return (
    (cause instanceof DOMException &&
      (cause.name === "AbortError" || cause.name === "TimeoutError")) ||
    (typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      (cause.name === "AbortError" || cause.name === "TimeoutError"))
  );
}

function validateCurrentVersion(currentVersion: string): string {
  try {
    const parsed = StableVersion.parse(currentVersion);
    if (versionFromStableTag(`v${parsed}`) !== parsed) throw new Error("invalid version");
    return parsed;
  } catch {
    throw error("invalid_current_version");
  }
}

function selectGitHubPayload(value: unknown): GitHubReleasePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw error("malformed_response");
  }

  const record = value as Record<string, unknown>;
  return GitHubReleasePayload.parse({
    tag_name: record.tag_name,
    draft: record.draft,
    prerelease: record.prerelease,
    html_url: record.html_url,
    published_at: record.published_at,
    name: record.name,
    body: record.body,
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the release result or public error takes precedence.
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/.test(normalizedLength)) {
      await cancelResponseBody(response);
      throw error("malformed_response");
    }

    const byteLength = Number(normalizedLength);
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw error("malformed_response");
    }
  }

  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains the public error even if cancellation fails.
        }
        throw error("malformed_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function cacheResult(
  currentVersion: string,
  value: LatestStableReleaseResult,
  response: Response,
  checkedAt: number,
): LatestStableReleaseResult {
  releaseCache.set(currentVersion, {
    value,
    etag: response.headers.get("etag"),
    checkedAt,
  });
  return value;
}

function truncateSummary(summary: string): string {
  const truncated = summary.slice(0, MAX_SUMMARY_CHARACTERS);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff
    ? truncated.slice(0, -1)
    : truncated;
}

function parseStableRelease(
  payload: GitHubReleasePayload,
  currentVersion: string,
): LatestStableReleaseResult {
  const version = versionFromStableTag(payload.tag_name);
  const expectedUrl = `${EXPECTED_RELEASE_URL_PREFIX}${payload.tag_name}`;
  if (payload.html_url !== expectedUrl) throw error("repository_mismatch");

  const release = StableRelease.parse({
    tag: payload.tag_name,
    version,
    name: payload.name ?? payload.tag_name,
    summary: truncateSummary(payload.body ?? ""),
    htmlUrl: payload.html_url,
    publishedAt: payload.published_at,
  });

  return {
    state: isStableUpgrade(currentVersion, version) ? "available" : "up_to_date",
    release,
  };
}

async function requestLatestStableRelease(
  currentVersion: string,
  cached: CachedReleaseResult | undefined,
  checkedAt: number,
  fetchImpl: typeof fetch,
): Promise<LatestStableReleaseResult> {
  const headers: Record<string, string> = {
    Accept: GITHUB_ACCEPT_HEADER,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  let response: Response;
  try {
    response = await fetchImpl(GITHUB_RELEASE_ENDPOINT, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (cause) {
    if (isTimeoutOrAbortError(cause)) throw error("timeout");
    throw error("network_failure");
  }

  try {
    if (response.status === 304) {
      await cancelResponseBody(response);
      if (!cached?.etag) throw error("malformed_response");
      cached.checkedAt = checkedAt;
      cached.etag = response.headers.get("etag") ?? cached.etag;
      return cached.value;
    }

    if (response.status === 404) {
      await cancelResponseBody(response);
      return cacheResult(currentVersion, { state: "none", release: null }, response, checkedAt);
    }

    const rateLimitExhausted =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")));
    if (rateLimitExhausted) {
      await cancelResponseBody(response);
      throw error("rate_limit");
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      throw error("http_failure");
    }

    const body = await readBoundedBody(response);
    const payload = selectGitHubPayload(JSON.parse(body) as unknown);
    if (payload.draft || payload.prerelease) {
      return cacheResult(currentVersion, { state: "none", release: null }, response, checkedAt);
    }

    const result = parseStableRelease(payload, currentVersion);
    return cacheResult(currentVersion, result, response, checkedAt);
  } catch (cause) {
    if (cause instanceof GitHubReleaseError) throw cause;
    if (isTimeoutOrAbortError(cause)) throw error("timeout");
    throw error("malformed_response");
  }
}

export async function checkLatestStableRelease({
  currentVersion: rawCurrentVersion,
  force = false,
  fetchImpl = fetch,
  now = Date.now,
}: CheckLatestStableReleaseOptions): Promise<LatestStableReleaseResult> {
  const currentVersion = validateCurrentVersion(rawCurrentVersion);
  const checkedAt = now();
  const cached = releaseCache.get(currentVersion);

  if (!force && cached && checkedAt - cached.checkedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const existing = inFlightReleaseChecks.get(currentVersion);
  if (existing) return existing;

  let inFlight!: Promise<LatestStableReleaseResult>;
  inFlight = requestLatestStableRelease(currentVersion, cached, checkedAt, fetchImpl).finally(() => {
    if (inFlightReleaseChecks.get(currentVersion) === inFlight) {
      inFlightReleaseChecks.delete(currentVersion);
    }
  });
  inFlightReleaseChecks.set(currentVersion, inFlight);
  return inFlight;
}
