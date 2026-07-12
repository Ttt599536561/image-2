# GitHub Release Admin Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only update page that checks the fixed official GitHub repository for a newer stable Release and safely delegates one-click site upgrades to a constrained Debian systemd updater.

**Architecture:** React Router server code owns version checks, admin authorization, request creation, status polling, and a root maintenance middleware. The Web container can write only a fixed inbox and read only a sanitized status directory; a root-owned host updater independently validates the official Release, drains writers, backs up data, switches to the exact tag, rebuilds, migrates, restarts, and records atomic status. Stable releases are created only by the existing CI workflow after tag, version, quality, deployment, and monotonicity checks pass.

**Tech Stack:** React 19, React Router 8 middleware/framework mode, TypeScript 6, Zod 4, Vitest, Testing Library, `semver` 7, Bash, jq, systemd, Docker Compose, PostgreSQL 17, GitHub CLI/Actions, Playwright.

**Design:** `docs/superpowers/specs/2026-07-12-github-release-admin-updater-design.md`

---

## File Structure

### Shared and Web Runtime

- Create `src/contracts/system-update.ts`: client-safe strict Zod schemas for releases, requests, public status, snapshots, and start/check responses.
- Create `src/server/system-update/semver.ts`: stable tag parsing and upgrade comparison through the direct `semver` dependency.
- Create `src/server/system-update/version.server.ts`: read and validate baked `APP_VERSION` and `APP_COMMIT_SHA`.
- Create `src/server/system-update/github-release.server.ts`: fixed GitHub endpoint, bounded fetch, ETag/five-minute cache, response and repository validation.
- Create `src/server/system-update/state.server.ts`: safe status reads and atomic no-replace request creation at fixed container paths.
- Create `src/server/system-update/maintenance-guard.server.ts`: root middleware that blocks all HTTP writes while maintenance is active.
- Create `src/server/system-update/request-security.server.ts`: strict JSON Content-Type and same-origin checks for update POSTs.
- Create `app/routes/api.admin.system-update.ts`: admin status loader and start action.
- Create `app/routes/api.admin.system-update.check.ts`: forced admin Release check action.
- Create `app/routes/_admin.system-update.tsx`: update UI, confirmation, polling, disconnect fallback, and recovery display.
- Create `src/components/admin/SystemUpdate.module.css`: page-specific responsive layout and stable dimensions.

### Host Runtime and Deployment

- Create `deploy/ai-image-workshop-update`: installed root updater with `process-request`, `status`, `recover`, and boot reconciliation commands.
- Create `deploy/system-update.test.sh`: fake-command contract suite for the updater and recovery state machine.
- Create `deploy/systemd/ai-image-workshop-update.service.in`: hardened rendered oneshot service.
- Create `deploy/systemd/ai-image-workshop-update.path`: fixed inbox watcher.
- Modify `deploy/install-lib.sh` and `deploy/install.sh`: provision the updater group/directories/config/binary/units, migrate old environment files, and enable units only after site health succeeds.
- Modify `deploy/backup.sh`: retain root-pinned recovery backups even when more than seven ordinary backups exist.
- Modify `compose.yaml`: mount updater inbox RW and state RO only into `web`, with a dedicated supplementary GID and no Docker socket/project mount.
- Modify `deploy/ci-smoke.sh`: use temporary updater directories and prove mount permissions and service isolation.

### Versioning, Release, and Documentation

- Modify `package.json` and `package-lock.json`: version `0.2.0`, direct runtime `semver`, release validation command, and updater shell contract in `test:deploy`.
- Modify `Dockerfile`: fail-closed build args and baked runtime metadata.
- Create `scripts/validate-release.ts` and `scripts/validate-release.test.ts`: tag/package/lock/latest-release gate.
- Modify `.github/workflows/ci.yml`: tag CI metadata, full tag gates, serialized release job, and stable/latest publication.
- Modify deployment/admin/architecture/ops documentation and progress status.

---

### Task 1: Add Version and System-Update Contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/contracts/system-update.ts`
- Create: `src/contracts/system-update.test.ts`
- Create: `src/server/system-update/semver.ts`
- Create: `src/server/system-update/semver.test.ts`
- Modify: `src/contracts/error.ts`

- [ ] **Step 1: Write failing contract and SemVer tests**

Create tests that pin strict stable tags, exact status keys, conditional recovery commands, build-metadata comparison, and new error codes:

```ts
import { describe, expect, it } from "vitest";
import { SystemUpdateStatus, UpdateRequest } from "./system-update";

const idle = {
  protocolVersion: 1,
  requestId: null,
  currentVersion: "0.2.0",
  targetVersion: null,
  phase: "idle",
  maintenance: false,
  startedAt: null,
  finishedAt: null,
  updatedAt: "2026-07-12T10:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  backupId: null,
  recoveryCommand: null,
};

describe("system update contracts", () => {
  it("accepts the exact idle status and rejects unknown keys", () => {
    expect(SystemUpdateStatus.parse(idle)).toEqual(idle);
    expect(SystemUpdateStatus.safeParse({ ...idle, command: "sh" }).success).toBe(false);
  });

  it("requires the fixed recovery command only for recovery_required", () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const recovering = {
      ...idle,
      requestId,
      targetVersion: "0.3.0",
      phase: "recovery_required",
      maintenance: true,
      recoveryCommand: `sudo /usr/local/sbin/ai-image-workshop-update recover ${requestId}`,
    };
    expect(SystemUpdateStatus.safeParse(recovering).success).toBe(true);
    expect(SystemUpdateStatus.safeParse({ ...recovering, recoveryCommand: "sudo sh anything" }).success).toBe(false);
  });

  it("accepts only the four request keys", () => {
    const request = {
      protocolVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000001",
      requestedAt: "2026-07-12T10:00:00.000Z",
      requestedBy: "00000000-0000-4000-8000-000000000002",
    };
    expect(UpdateRequest.parse(request)).toEqual(request);
    expect(UpdateRequest.safeParse({ ...request, repository: "evil/repo" }).success).toBe(false);
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { isStableUpgrade, versionFromStableTag } from "./semver";

describe("stable system update versions", () => {
  it.each(["v1.0.0-alpha.1", "v01.0.0", "1.0.0", "v1.0", "v1.0.0+build"])(
    "rejects %s as a stable Release tag",
    (tag) => expect(() => versionFromStableTag(tag)).toThrow(),
  );
  it("allows only a strictly higher stable version and ignores current build metadata", () => {
    expect(isStableUpgrade("0.2.0+abc123", "0.2.1")).toBe(true);
    expect(isStableUpgrade("0.2.0+abc123", "0.2.0")).toBe(false);
    expect(isStableUpgrade("1.0.0", "0.9.9")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx vitest run src/contracts/system-update.test.ts src/server/system-update/semver.test.ts
```

Expected: FAIL because the contract and SemVer modules do not exist.

- [ ] **Step 3: Bump the feature version and install direct SemVer dependencies**

Run these separately:

```bash
npm version 0.2.0 --no-git-tag-version
npm install --save-exact semver@7.8.5
npm install --save-dev --save-exact @types/semver@7.7.1
```

Expected: `package.json` and the lockfile root both report `0.2.0`; `semver` is a direct production dependency.

- [ ] **Step 4: Implement the strict shared contract**

Define these exact public values in `src/contracts/system-update.ts`:

```ts
import { z } from "zod";

export const UPDATE_PROTOCOL_VERSION = 1 as const;
export const SYSTEM_UPDATE_PHASES = [
  "idle", "claiming", "validating", "checking_release", "preflight",
  "entering_maintenance", "draining", "stopping_writers", "backing_up",
  "fetching", "building", "migrating", "starting_services", "health_check",
  "completed", "failed", "recovery_required", "recovering", "recovered",
] as const;
export const SystemUpdatePhase = z.enum(SYSTEM_UPDATE_PHASES);
export type SystemUpdatePhase = z.infer<typeof SystemUpdatePhase>;

export const StableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const StableTag = z.string().regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const CommitSha = z.string().regex(/^(unknown|[0-9a-f]{40,64})$/);

export const UpdateRequest = z.object({
  protocolVersion: z.literal(UPDATE_PROTOCOL_VERSION),
  requestId: z.uuid(),
  requestedAt: z.iso.datetime(),
  requestedBy: z.uuid(),
}).strict();
export type UpdateRequest = z.infer<typeof UpdateRequest>;

const nullableVersion = StableVersion.nullable();
const nullableTime = z.iso.datetime().nullable();
export const SystemUpdateStatus = z.object({
  protocolVersion: z.literal(UPDATE_PROTOCOL_VERSION),
  requestId: z.uuid().nullable(),
  currentVersion: StableVersion,
  targetVersion: nullableVersion,
  phase: SystemUpdatePhase,
  maintenance: z.boolean(),
  startedAt: nullableTime,
  finishedAt: nullableTime,
  updatedAt: z.iso.datetime(),
  errorCode: z.string().max(80).nullable(),
  errorMessage: z.string().max(500).nullable(),
  backupId: z.string().regex(/^\d{8}T\d{6}Z$/).nullable(),
  recoveryCommand: z.string().max(200).nullable(),
}).strict().superRefine((status, ctx) => {
  const expected = status.requestId == null
    ? null
    : `sudo /usr/local/sbin/ai-image-workshop-update recover ${status.requestId}`;
  if (status.phase === "recovery_required" && status.recoveryCommand !== expected) {
    ctx.addIssue({ code: "custom", path: ["recoveryCommand"], message: "invalid recovery command" });
  }
  if (status.phase !== "recovery_required" && status.recoveryCommand !== null) {
    ctx.addIssue({ code: "custom", path: ["recoveryCommand"], message: "unexpected recovery command" });
  }
});
export type SystemUpdateStatus = z.infer<typeof SystemUpdateStatus>;

export const BuildInfo = z.object({
  version: StableVersion,
  commitSha: CommitSha,
  shortCommitSha: z.string().regex(/^(unknown|[0-9a-f]{7,12})$/),
}).strict();
export const StableRelease = z.object({
  tag: StableTag,
  version: StableVersion,
  name: z.string().max(200),
  summary: z.string().max(1000),
  htmlUrl: z.url(),
  publishedAt: z.iso.datetime(),
}).strict();
export const UpdateSnapshot = z.object({
  enabled: z.boolean(),
  disabledReason: z.string().max(300).nullable(),
  build: BuildInfo,
  status: SystemUpdateStatus.nullable(),
  releaseState: z.enum(["unchecked", "none", "up_to_date", "available"]),
  latestRelease: StableRelease.nullable(),
}).strict();
export const StartSystemUpdate = z.object({ action: z.literal("start") }).strict();
export const StartSystemUpdateResponse = z.object({ requestId: z.uuid(), targetVersion: StableVersion }).strict();
```

Add `MAINTENANCE`, `UPDATE_UNAVAILABLE`, and `UPDATE_CONFLICT` to `API_ERROR_CODES` in `src/contracts/error.ts`.

- [ ] **Step 5: Implement SemVer helpers and make the focused tests GREEN**

```ts
import semver from "semver";
import { StableTag, StableVersion } from "../../contracts/system-update";

export function versionFromStableTag(tag: string): string {
  const parsedTag = StableTag.parse(tag);
  return StableVersion.parse(parsedTag.slice(1));
}

export function isStableUpgrade(current: string, target: string): boolean {
  const currentVersion = semver.valid(current);
  const targetVersion = StableVersion.parse(target);
  if (!currentVersion) throw new Error("invalid current version");
  return semver.gt(targetVersion, currentVersion);
}
```

Run:

```bash
npx vitest run src/contracts/system-update.test.ts src/server/system-update/semver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the shared contract**

```bash
git add package.json package-lock.json src/contracts/error.ts src/contracts/system-update.ts src/contracts/system-update.test.ts src/server/system-update/semver.ts src/server/system-update/semver.test.ts
git commit -m "feat: define system update contracts"
```

### Task 2: Add Build Metadata and the GitHub Release Client

**Files:**
- Create: `src/server/system-update/version.server.ts`
- Create: `src/server/system-update/version.server.test.ts`
- Create: `src/server/system-update/github-release.server.ts`
- Create: `src/server/system-update/github-release.server.test.ts`

- [ ] **Step 1: Write failing version and GitHub client tests**

Cover valid metadata, missing/invalid metadata, success, `404`, draft/prerelease, wrong repository URL, invalid tag, equal/lower version, timeout, `429`, ETag, and the five-minute cache. Use injected `env`, `fetchImpl`, and `now` rather than mutating global state:

```ts
it("returns an available official stable release", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    tag_name: "v0.3.0", draft: false, prerelease: false,
    name: "v0.3.0", body: "release notes",
    html_url: "https://github.com/Ttt599536561/image-2/releases/tag/v0.3.0",
    published_at: "2026-07-20T00:00:00.000Z",
  }), { status: 200, headers: { ETag: '"release-etag"' } }));

  const result = await checkLatestStableRelease({
    currentVersion: "0.2.0",
    force: true,
    fetchImpl,
    now: () => Date.parse("2026-07-20T01:00:00.000Z"),
  });

  expect(result.state).toBe("available");
  expect(result.release?.version).toBe("0.3.0");
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.github.com/repos/Ttt599536561/image-2/releases/latest",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npx vitest run src/server/system-update/version.server.test.ts src/server/system-update/github-release.server.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement validated build metadata**

`getCurrentBuild(env = process.env)` must require a stable `APP_VERSION`, require `APP_COMMIT_SHA` to be `unknown` or 40-64 lowercase hex characters, and derive a 12-character display SHA:

```ts
import { BuildInfo } from "../../contracts/system-update";

export function getCurrentBuild(env: NodeJS.ProcessEnv = process.env) {
  const commitSha = env.APP_COMMIT_SHA ?? "unknown";
  return BuildInfo.parse({
    version: env.APP_VERSION,
    commitSha,
    shortCommitSha: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 12),
  });
}
```

- [ ] **Step 4: Implement the fixed GitHub Release client**

Use a strict Zod schema, `AbortSignal.timeout(8_000)`, fixed headers, no caller-controlled URL, a 1 MiB response limit, ETag revalidation, and an in-module cache keyed by current version. Expose `resetReleaseCacheForTests()` only for tests. Return exactly `{ state: "none" | "up_to_date" | "available", release: StableRelease | null }`; throw typed `GitHubReleaseError` for timeout, rate limit, malformed response, repository mismatch, and other HTTP failures. React will later render `summary` as text, so truncate the body to 1,000 characters without interpreting Markdown/HTML.

- [ ] **Step 5: Run focused tests and commit**

```bash
npx vitest run src/server/system-update/version.server.test.ts src/server/system-update/github-release.server.test.ts
git add src/server/system-update/version.server.ts src/server/system-update/version.server.test.ts src/server/system-update/github-release.server.ts src/server/system-update/github-release.server.test.ts
git commit -m "feat: check official GitHub releases"
```

Expected: all focused tests PASS.

### Task 3: Add Safe State I/O and the Root Maintenance Middleware

**Files:**
- Create: `src/server/system-update/state.server.ts`
- Create: `src/server/system-update/state.server.test.ts`
- Create: `src/server/system-update/maintenance-guard.server.ts`
- Create: `src/server/system-update/maintenance-guard.server.test.ts`
- Modify: `app/root.tsx`
- Create: `app/root.maintenance.test.ts`

- [ ] **Step 1: Write failing state-file tests**

Use temporary directories and verify: missing status means updater disabled, a valid regular status parses, symlinks/oversized/unknown-key/protocol-invalid status fail closed, a request is complete before it appears at `request.json`, and a second request returns conflict without replacement. Assert no repository/tag/path/command fields can enter the request.

- [ ] **Step 2: Write failing middleware tests**

Test the exported middleware function directly with a fake `next` and a temporary status reader:

```ts
it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s during maintenance", async (method) => {
  const response = await rejectHttpWriteDuringMaintenance(
    { request: new Request("https://site.test/api/redeem", { method }) },
    vi.fn(),
    async () => true,
  );
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(503);
});

it.each(["GET", "HEAD", "OPTIONS"])("allows %s", async (method) => {
  const next = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  await rejectHttpWriteDuringMaintenance(
    { request: new Request("https://site.test/healthz", { method }) },
    next,
    async () => true,
  );
  expect(next).toHaveBeenCalledOnce();
});
```

Add an integration test that imports the root `middleware` export and proves a resource-route POST is stopped before its action callback.

- [ ] **Step 3: Run tests and confirm RED**

```bash
npx vitest run src/server/system-update/state.server.test.ts src/server/system-update/maintenance-guard.server.test.ts app/root.maintenance.test.ts
```

Expected: FAIL because the modules and root middleware do not exist.

- [ ] **Step 4: Implement safe file reads and atomic no-replace request creation**

Use fixed production container paths:

```ts
export const UPDATE_INBOX_PATH = "/run/ai-image-workshop-updater/inbox";
export const UPDATE_STATUS_PATH = "/run/ai-image-workshop-updater/state/status.json";
export const MAX_UPDATE_JSON_BYTES = 64 * 1024;
```

`readSystemUpdateStatus(path = UPDATE_STATUS_PATH)` must open with `O_RDONLY | O_NOFOLLOW`, `fstat` the opened descriptor, require a regular file no larger than 64 KiB, read UTF-8, and parse `SystemUpdateStatus`. Return `null` only for `ENOENT`; propagate malformed/symlink/permission errors.

`createSystemUpdateRequest(request, inbox = UPDATE_INBOX_PATH)` must write and fsync a mode-`0600` UUID temp file using `O_CREAT | O_EXCL | O_NOFOLLOW`, hard-link it to `request.json` so the fixed file appears atomically without replacement, fsync the inbox directory after the link, and unlink the temp file in `finally`. Translate `EEXIST` to `UpdateRequestConflictError`.

- [ ] **Step 5: Implement and register the root middleware**

```ts
import type { MiddlewareFunction } from "react-router";
import { httpError } from "../../contracts/error";
import { readSystemUpdateStatus } from "./state.server";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function rejectHttpWriteDuringMaintenance(
  { request }: { request: Request },
  next: () => Promise<Response>,
  isMaintenance: () => Promise<boolean> = async () => {
    const status = await readSystemUpdateStatus();
    return status?.maintenance === true;
  },
): Promise<Response> {
  if (!WRITE_METHODS.has(request.method.toUpperCase())) return next();
  try {
    if (!(await isMaintenance())) return next();
  } catch {
    return httpError(503, "MAINTENANCE", "系统维护状态不可用，暂时禁止写入");
  }
  return httpError(503, "MAINTENANCE", "系统正在更新，请稍后重试");
}

export const maintenanceMiddleware: MiddlewareFunction<Response> = (args, next) =>
  rejectHttpWriteDuringMaintenance(args, next);
```

In `app/root.tsx` export `middleware: Route.MiddlewareFunction[] = [maintenanceMiddleware]`. Do not add per-action guards and do not exempt update POSTs; the approved spec allows only read requests while maintenance is active.

- [ ] **Step 6: Run focused tests and commit**

```bash
npx vitest run src/server/system-update/state.server.test.ts src/server/system-update/maintenance-guard.server.test.ts app/root.maintenance.test.ts
git add app/root.tsx app/root.maintenance.test.ts src/server/system-update/state.server.ts src/server/system-update/state.server.test.ts src/server/system-update/maintenance-guard.server.ts src/server/system-update/maintenance-guard.server.test.ts
git commit -m "feat: enforce system update maintenance mode"
```

Expected: PASS.

### Task 4: Add Admin Update APIs

**Files:**
- Create: `src/server/system-update/request-security.server.ts`
- Create: `src/server/system-update/request-security.server.test.ts`
- Create: `app/routes/api.admin.system-update.ts`
- Create: `app/routes/api.admin.system-update.test.ts`
- Create: `app/routes/api.admin.system-update.check.ts`
- Create: `app/routes/api.admin.system-update.check.test.ts`
- Modify: `app/routes.ts`
- Modify: `src/server/admin/audit.server.ts`

- [ ] **Step 1: Write failing security and route tests**

Mock `requireAdmin`, Release lookup, status I/O, and `writeAuditHttp`. Cover non-admin responses, missing/wrong Origin, non-JSON Content-Type, disabled updater, no newer release, valid `202`, duplicate `409`, GitHub failure, and the ordering requirement that audit completes before the request file is created.

Use `https://images.example.com` as `BETTER_AUTH_URL` and include `Origin: https://images.example.com` plus `Content-Type: application/json` in successful requests.

- [ ] **Step 2: Run route tests and confirm RED**

```bash
npx vitest run src/server/system-update/request-security.server.test.ts app/routes/api.admin.system-update.test.ts app/routes/api.admin.system-update.check.test.ts
```

Expected: FAIL because the security helper and routes do not exist.

- [ ] **Step 3: Implement strict POST security**

`requireSystemUpdatePost(request, env = process.env)` must require `request.method === "POST"`, parse the media type before `;`, require exactly `application/json`, require a nonempty `Origin`, and compare `new URL(origin).origin` to `new URL(env.BETTER_AUTH_URL).origin`. Return the existing JSON error envelope with `405`, `415`, or `403`; never accept a missing Origin.

- [ ] **Step 4: Implement the status/start route**

Register these paths in `app/routes.ts`:

```ts
route("api/admin/system-update", "routes/api.admin.system-update.ts"),
route("api/admin/system-update/check", "routes/api.admin.system-update.check.ts"),
// inside the _admin layout
route("admin/system-update", "routes/_admin.system-update.tsx"),
```

The loader must call `requireAdmin`, read build/status, and return `UpdateSnapshot` with `releaseState: "unchecked"` without calling GitHub.

The action must: validate POST security, call `requireAdmin`, parse `StartSystemUpdate`, read/validate status and inbox availability, force-check the official Release, require `available`, create a UUID request, write `system_update_start` audit with target/current/request metadata, then create the request file. Return `202` with `StartSystemUpdateResponse`. Map active/request-file conflicts to `409 UPDATE_CONFLICT`; map missing/malformed control state to `503 UPDATE_UNAVAILABLE`.

- [ ] **Step 5: Implement the forced check route**

The check action uses the same POST/admin/origin/content-type guards, calls `checkLatestStableRelease({ currentVersion, force: true })`, and returns an `UpdateSnapshot` with `none`, `up_to_date`, or `available`. It does not write audit or request files. Root maintenance middleware blocks this POST while maintenance is active.

- [ ] **Step 6: Run focused tests and commit**

```bash
npx vitest run src/server/system-update/request-security.server.test.ts app/routes/api.admin.system-update.test.ts app/routes/api.admin.system-update.check.test.ts
git add app/routes.ts app/routes/api.admin.system-update.ts app/routes/api.admin.system-update.test.ts app/routes/api.admin.system-update.check.ts app/routes/api.admin.system-update.check.test.ts src/server/system-update/request-security.server.ts src/server/system-update/request-security.server.test.ts src/server/admin/audit.server.ts
git commit -m "feat: expose admin system update APIs"
```

Expected: PASS.

### Task 5: Build the Admin System-Update Experience

**Files:**
- Create: `app/routes/_admin.system-update.tsx`
- Create: `app/routes/_admin.system-update.test.tsx`
- Create: `src/components/admin/SystemUpdate.module.css`
- Modify: `app/routes/_admin.tsx`
- Create: `app/routes/_admin.test.tsx`
- Modify: `src/components/admin/Admin.module.css`

- [ ] **Step 1: Write failing page and navigation tests**

Cover the following concrete states: updater disabled, unchecked, no Release, up to date, update available, confirmation open, request accepted, active phase polling, network disconnect with `status REQUEST_ID`, completed version, failed pre-migration, and `recovery_required` with the exact recovery command. Assert “立即更新” is enabled only for `available + idle + enabled`. Assert the admin nav contains `RefreshCw`/“系统更新” and the mobile menu can open/close.

- [ ] **Step 2: Run UI tests and confirm RED**

```bash
npx vitest run app/routes/_admin.system-update.test.tsx app/routes/_admin.test.tsx
```

Expected: FAIL because the page and navigation item do not exist.

- [ ] **Step 3: Implement the loader and UI state machine**

The loader calls `requireAdminPage`, `getCurrentBuild`, and `readSystemUpdateStatus`, then returns the initial unchecked snapshot.

The component must use `apiPost` for check/start and `apiGet` for polling. Persist the accepted request ID in `sessionStorage` under `ai-image-workshop:update-request`; poll every two seconds only while the status phase is active or a stored request is unresolved. On fetch failure, keep the last known phase, show “服务重启中，正在重新连接”, and show this non-success fallback without inferring failure:

```ts
const statusCommand = requestId
  ? `sudo /usr/local/sbin/ai-image-workshop-update status ${requestId}`
  : null;
```

Render release notes as normal JSX text and open only the validated `htmlUrl` with `target="_blank" rel="noreferrer"`. Use `RefreshCw`, `Download`, `ExternalLink`, `CheckCircle2`, `AlertTriangle`, `LoaderCircle`, and `Copy` from `lucide-react`. Reuse `ConfirmDialog`; its message must name the target version, backup, several-minute maintenance window, and temporary disconnect.

- [ ] **Step 4: Add page-specific responsive CSS**

Use two version columns above 760px and one column below it; constrain buttons to stable 38px height; set `overflow-wrap: anywhere` on versions/errors/commands; use existing semantic tokens; keep card radius at the existing admin token; and do not nest cards. Add a mobile admin header/menu in `_admin.tsx` and CSS that moves the nav off-canvas below 760px without changing desktop layout.

- [ ] **Step 5: Run UI tests and commit**

```bash
npx vitest run app/routes/_admin.system-update.test.tsx app/routes/_admin.test.tsx
git add app/routes/_admin.system-update.tsx app/routes/_admin.system-update.test.tsx app/routes/_admin.tsx app/routes/_admin.test.tsx src/components/admin/SystemUpdate.module.css src/components/admin/Admin.module.css
git commit -m "feat: add admin system update page"
```

Expected: PASS.

### Task 6: Bake Version Metadata and Isolate Updater Mounts

**Files:**
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `deploy/.env.production.example`
- Modify: `deploy/install-lib.sh`
- Modify: `deploy/install-lib.test.sh`
- Modify: `deploy/install.sh`
- Modify: `deploy/install.test.sh`
- Modify: `deploy/backup.sh`
- Modify: `deploy/restore.sh`
- Modify: `deploy/backup-restore.test.sh`
- Modify: `deploy/ci-smoke.sh`
- Modify: `deploy/ci-smoke.test.sh`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `.dockerignore`

- [ ] **Step 1: Extend deployment contracts first**

Add failing assertions for:

- `UPDATER_CONTROL_ROOT=/var/lib/ai-image-workshop-updater` and numeric `UPDATER_CONTROL_GID` in rendered/loaded production env.
- old env migration appends each updater key exactly once without changing secrets.
- Docker build receives package version and full current commit.
- the existing CI Docker build passes exact package-version/full-commit args, while `docker compose config` remains usable without transient build metadata.
- Compose uses `bind.create_host_path: false`, mounts inbox RW/state RO only on `web`, and never mounts Docker socket/project root.
- worker/scheduler have neither updater mount nor updater supplementary group.
- CI smoke creates and removes a temporary control root, Web can write inbox but not state, and worker/scheduler cannot see the control paths.
- backup/restore safe environment loaders accept and unexport the two new keys.

- [ ] **Step 2: Run deployment tests and confirm RED**

```bash
bash deploy/install-lib.test.sh
bash deploy/install.test.sh
bash deploy/backup-restore.test.sh
bash deploy/ci-smoke.test.sh
```

Expected: FAIL on the new updater environment/mount assertions.

- [ ] **Step 3: Add fail-closed Docker build metadata**

In the runtime stage, after copying `package.json`, add:

```dockerfile
ARG APP_VERSION
ARG APP_COMMIT_SHA
RUN node -e "const p=require('./package.json');const [v,s]=process.argv.slice(1);if(v!==p.version)throw Error('APP_VERSION mismatch');if(!/^[0-9a-f]{40,64}$/.test(s))throw Error('invalid APP_COMMIT_SHA')" "$APP_VERSION" "$APP_COMMIT_SHA"
ENV APP_VERSION=${APP_VERSION} APP_COMMIT_SHA=${APP_COMMIT_SHA}
```

Keep both values out of the client build stage.

- [ ] **Step 4: Add the web-only control mounts**

Change the shared build stanza and override `web.volumes` explicitly:

```yaml
x-app: &app
  build:
    context: .
    args:
      APP_VERSION: ${BUILD_APP_VERSION:-invalid}
      APP_COMMIT_SHA: ${BUILD_APP_COMMIT_SHA:-invalid}

services:
  web:
    <<: *app
    group_add:
      - "${UPDATER_CONTROL_GID:?UPDATER_CONTROL_GID is required}"
    volumes:
      - media_data:/app/data/media
      - type: bind
        source: ${UPDATER_CONTROL_ROOT:?UPDATER_CONTROL_ROOT is required}/inbox
        target: /run/ai-image-workshop-updater/inbox
        bind:
          create_host_path: false
      - type: bind
        source: ${UPDATER_CONTROL_ROOT:?UPDATER_CONTROL_ROOT is required}/state
        target: /run/ai-image-workshop-updater/state
        read_only: true
        bind:
          create_host_path: false
```

Worker and scheduler continue inheriting only `media_data` and do not receive `group_add`.

- [ ] **Step 5: Extend safe deployment environment handling**

Create/reuse the `ai-image-workshop-updater` system group first, then create the fixed control root plus `inbox`, `state`, and `work` with their final owners/modes before any `docker compose config`, build, or up command. Allow/render/load `UPDATER_CONTROL_ROOT` and `UPDATER_CONTROL_GID`; production requires the fixed root and the resolved positive numeric group ID. Add an atomic old-env migration helper that validates the existing file, copies it to a mode-`0600` temp file, appends only missing updater keys, fsyncs the file and parent directory, and renames. Never source the env file and never re-render existing secrets from shell interpolation.

Before each Compose build, compute metadata with structured JSON parsing and Git:

```bash
BUILD_APP_VERSION="$(jq -er '.version' package.json)"
BUILD_APP_COMMIT_SHA="$(git rev-parse --verify HEAD)"
export BUILD_APP_VERSION BUILD_APP_COMMIT_SHA
compose build web
```

These `BUILD_*` names are process-local build inputs only; never persist `APP_VERSION` or `APP_COMMIT_SHA` in `deploy/.env.production`, because Compose service environment would override the metadata baked into the target image. Add `git`, `jq`, `systemctl`, and `getent` to Debian preflight requirements. Document them later as deployment prerequisites.

Update the existing CI Docker build at the same time to pass `--build-arg APP_VERSION="$(jq -er '.version' package.json)" --build-arg APP_COMMIT_SHA="$GITHUB_SHA"`; this keeps branch and pull-request builds working before the release workflow is added in Task 10. Runtime dependency validation must require `semver` and must not treat `@types/semver` as a production dependency.

- [ ] **Step 6: Update CI smoke isolation**

Create a `mktemp -d` control root inside the ignored `deploy/.ci-smoke.*` namespace, create `inbox/state`, set its group to the smoke process GID, write the two env keys, and delete it only after Compose teardown. Prefer checked `rmdir` of empty directories; unexpected files make cleanup fail. Add `.local-system-update/` and generated CI control paths to Git/Docker ignore rules.

- [ ] **Step 7: Run deployment contracts and commit**

```bash
bash deploy/install-lib.test.sh
bash deploy/install.test.sh
bash deploy/backup-restore.test.sh
bash deploy/ci-smoke.test.sh
npm run docker:validate
git add Dockerfile compose.yaml deploy/.env.production.example deploy/install-lib.sh deploy/install-lib.test.sh deploy/install.sh deploy/install.test.sh deploy/backup.sh deploy/restore.sh deploy/backup-restore.test.sh deploy/ci-smoke.sh deploy/ci-smoke.test.sh .github/workflows/ci.yml .gitignore .dockerignore
git commit -m "feat: add updater runtime boundaries"
```

Expected: all commands PASS.

### Task 7: Implement the Host Updater Success and Pre-Migration Paths

**Files:**
- Create: `deploy/ai-image-workshop-update`
- Create: `deploy/system-update.test.sh`
- Modify: `package.json`

- [ ] **Step 1: Build the fake-command contract harness**

Create a TAP-style suite with a canonical temporary project/control root and fake `curl`, `git`, `docker`, `jq`, `flock`, `timeout`, and `systemctl` commands. Every fake appends shell-escaped arguments to one command log. Production overrides are accepted only when `AI_IMAGE_WORKSHOP_UPDATE_TEST_MODE=1`; the test mode root must resolve below the suite temp directory.

Add failing cases for illegal subcommands/arguments, lock contention, symlink/oversized/duplicate-key request, fixed GitHub URL, invalid/draft/prerelease/equal release, dirty tracked worktree, request claim ordering, drain timeout, Web-stop/final-zero recount, backup-before-fetch/build/migrate, exact tag refspec, target tree version, image rollback tag, successful completion, and pre-migration rollback/health failure.

- [ ] **Step 2: Run the new shell suite and confirm RED**

```bash
bash deploy/system-update.test.sh
```

Expected: FAIL because `deploy/ai-image-workshop-update` does not exist.

- [ ] **Step 3: Implement fixed configuration, JSON, lock, and status primitives**

The updater must be self-contained after startup: load all required helpers before any checkout and never source files from the target tree afterward. Hardcode the official API/repository and production control paths. Validate root-owned config (`0600`, no symlink), deploy env through the same strict key rules, and the existing shared lock `/run/lock/ai-image-workshop-install.lock`.

Use `jq` for JSON generation/shape checks. Detect duplicate flat request keys with `jq --stream`, require exactly the four contract keys, bound input to 64 KiB, and re-open/revalidate after claim. `publish_status` must write every public v1 key through `jq -n`, chmod `0640`, fsync, and atomically rename into `state/status.json`; private old commit/image/service/backup details go only to root mode-`0600` `work/checkpoint.env`.

- [ ] **Step 4: Implement exact Release and runtime preflight**

`fetch_latest_release` uses bounded curl with `--proto '=https'`, no redirect following, fixed GitHub headers, and the hardcoded `/releases/latest` URL. Validate draft/prerelease false, strict stable tag, official `html_url`, and strictly greater numeric SemVer. Require a clean tracked worktree/index without reset/clean. Capture old commit, exact running writer set, configured image tag, and current image ID before maintenance.

- [ ] **Step 5: Implement the success orchestration in this exact order**

```bash
process_request() {
  acquire_operation_lock
  reconcile_interrupted_work
  validate_and_claim_request
  fetch_latest_release
  assert_clean_worktree
  capture_runtime_checkpoint
  publish_status entering_maintenance true
  drain_generations 300
  stop_web_and_recount
  stop_worker_and_scheduler
  require_zero_active_generations
  create_and_verify_pinned_backup
  tag_rollback_image
  fetch_and_validate_release_ref
  checkout_target_commit
  build_target_image
  mark_migration_boundary
  run_production_migrations
  start_target_services
  wait_for_web_health
  stage_next_updater
  complete_update
}
```

The backup call duplicates the held lock FD and sets a fixed timestamp plus leave-stopped mode. Fetch only `refs/tags/$TAG:refs/ai-image-workshop-updater/$REQUEST_ID`; peel to a commit and inspect that commit's `package.json` before checkout. Export the exact target version/SHA as process-local `BUILD_APP_VERSION`/`BUILD_APP_COMMIT_SHA` for Compose build. Write `migrating` atomically before the migration command. Success removes request/checkpoint, backup pin, rollback image tag, maintenance, and temporary ref only after HTTP 204.

- [ ] **Step 6: Implement pre-migration rollback**

Before `migrating`, any failure checks out the recorded old commit, retags the old image ID onto the configured image tag, starts only the captured original services, and waits for old health. Publish `failed` with maintenance false only after old health returns 204. If old health fails, keep maintenance true, retain checkpoint/backup/image, and publish a terminal error that requires operator inspection.

- [ ] **Step 7: Run the shell suite and add it to deployment tests**

```bash
bash deploy/system-update.test.sh
npm pkg set "scripts.test:deploy=bash deploy/install-lib.test.sh && bash deploy/install.test.sh && bash deploy/auth-migration.test.sh && bash deploy/backup-restore.test.sh && bash deploy/system-update.test.sh && bash deploy/ci-smoke.test.sh"
npm run test:deploy
```

Expected: PASS and no command/status output contains fixture secrets.

- [ ] **Step 8: Commit the updater success path**

```bash
git add deploy/ai-image-workshop-update deploy/system-update.test.sh package.json package-lock.json
git commit -m "feat: execute guarded host updates"
```

### Task 8: Add Recovery, Backup Pinning, and Boot Reconciliation

**Files:**
- Modify: `deploy/ai-image-workshop-update`
- Modify: `deploy/system-update.test.sh`
- Modify: `deploy/backup.sh`
- Modify: `deploy/backup-restore.test.sh`

- [ ] **Step 1: Add failing migration-boundary and recovery tests**

Cover failure at migration, service start, and health check; retained checkpoint/pin/old image; no automatic retry; exact status request ID; visible confirmation string; wrong ID refusal; checksum/manifest/dump revalidation; database-only `pg_restore`; no media restore; no migration during recovery; old image/commit/service restoration; recovery health failure preservation; successful cleanup; and boot reconciliation of claimed work before/after the migration boundary.

- [ ] **Step 2: Add failing backup retention tests**

Create eight valid backup directories where the oldest contains a regular `.system-update-pin`; in production its owner must be UID 0, while the harness may accept only the current test UID behind explicit `AI_IMAGE_WORKSHOP_UPDATE_TEST_MODE=1`. Assert retention deletes the oldest unpinned directory and keeps the pinned one. Reject a symlink pin and any production non-root owner.

- [ ] **Step 3: Run focused shell tests and confirm RED**

```bash
bash deploy/system-update.test.sh
bash deploy/backup-restore.test.sh
```

Expected: FAIL on recovery and pin behavior.

- [ ] **Step 4: Implement the migration failure boundary**

At or after the atomically recorded `migrating` phase, the EXIT handler stops writers, preserves request/checkpoint/backup pin/rollback tag, and publishes `recovery_required` with:

```text
sudo /usr/local/sbin/ai-image-workshop-update recover REQUEST_ID
```

It exits without looping. An unexpected boot/service restart runs `reconcile_interrupted_work`: pre-migration work attempts the old-service rollback; `migrating` or later becomes `recovery_required` without running migration again.

- [ ] **Step 5: Implement `status` and `recover`**

`status REQUEST_ID` requires the exact active ID, prints sanitized phase/version/backup fields, and prints the recovery command only for `recovery_required`.

`recover REQUEST_ID` acquires the shared lock, revalidates current state and all backup artifacts, and requires visible input exactly `RECOVER ai-image-workshop`. It stops writers, checks out the old commit, restores the old image tag, and runs only:

```bash
docker compose --env-file deploy/.env.production exec -T postgres \
  pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --exit-on-error --single-transaction --clean --if-exists \
  --no-owner --no-privileges <"$BACKUP_DIR/database.dump"
```

It must not restore media or run migrations. Start only the captured services and require old health. Success publishes `recovered`, clears maintenance/private work/pin/rollback tag; failure returns to `recovery_required` and retains every recovery artifact.

- [ ] **Step 6: Make backup retention pin-aware**

In `retain_recent_backups`, validate `.system-update-pin` as a root-owned regular non-symlink file and exclude pinned directories from deletion. Continue retaining the seven newest unpinned backups; a pin never counts toward the seven ordinary copies.

- [ ] **Step 7: Run tests and commit**

```bash
bash deploy/system-update.test.sh
bash deploy/backup-restore.test.sh
git add deploy/ai-image-workshop-update deploy/system-update.test.sh deploy/backup.sh deploy/backup-restore.test.sh
git commit -m "feat: recover interrupted system updates"
```

Expected: PASS.

### Task 9: Install and Harden the systemd Updater

**Files:**
- Create: `deploy/systemd/ai-image-workshop-update.service.in`
- Create: `deploy/systemd/ai-image-workshop-update.path`
- Modify: `deploy/install.sh`
- Modify: `deploy/install.test.sh`
- Modify: `deploy/ai-image-workshop-update`
- Modify: `deploy/system-update.test.sh`

- [ ] **Step 1: Add failing installer/systemd contract tests**

Assert dedicated system group creation/reuse, fixed production paths, directory owner/modes (`0750`, inbox `2770`, state `0750`, work `0700`), config `0600`, binary `0755`, status `0640`, rendered absolute `ReadWritePaths`, no Web/Docker socket exposure, daemon reload, service+path enable only after health, idempotent resume/upgrade, old-env key migration, and updater refresh only after successful target health.

- [ ] **Step 2: Run installer tests and confirm RED**

```bash
bash deploy/install.test.sh
bash deploy/system-update.test.sh
```

Expected: FAIL because unit files and provisioning are absent.

- [ ] **Step 3: Create the path and service units**

The path unit watches only `/var/lib/ai-image-workshop-updater/inbox/request.json` and is wanted by `multi-user.target`.

The rendered service runs `/usr/local/sbin/ai-image-workshop-update process-request` as root with `Type=oneshot`, `Restart=on-failure`, `UMask=0077`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`, kernel/control-group protections, bounded `AF_UNIX AF_INET AF_INET6`, and explicit `ReadWritePaths` for the project root, control root, global lock, Docker socket, and staged updater target. Also enable the service at boot so a claimed request is reconciled after power loss.

- [ ] **Step 4: Install updater files after revalidating bootstrap state**

Idempotently revalidate the system group, persisted numeric GID, fixed control root, bind-source owners/modes, and safe environment migration already established before Compose in Task 6. Then write root config atomically, render the service template with the canonical project path, and install the updater binary and path unit. Do not enable either unit yet.

- [ ] **Step 5: Initialize and enable only after health**

After fresh/resume/terminal-upgrade health succeeds, run the installed updater's `initialize`, verify the public idle status, then daemon-reload and enable/start both service and path. A UI-driven successful update stages and atomically replaces the next updater binary only after target health; it never replaces the running executable before the health gate.

- [ ] **Step 6: Verify units and all deployment contracts**

```bash
systemd-analyze verify deploy/systemd/ai-image-workshop-update.path "$rendered_service_test_unit"
bash deploy/install.test.sh
bash deploy/system-update.test.sh
npm run test:deploy
npm run docker:validate
```

Set `rendered_service_test_unit` to a temporary, concretely rendered service before the command. Expected: both units verify and all commands PASS.

- [ ] **Step 7: Commit systemd integration**

```bash
git add deploy/systemd/ai-image-workshop-update.service.in deploy/systemd/ai-image-workshop-update.path deploy/install.sh deploy/install.test.sh deploy/ai-image-workshop-update deploy/system-update.test.sh
git commit -m "feat: install constrained system updater"
```

### Task 10: Add Monotonic Stable Release Publication

**Files:**
- Create: `scripts/validate-release.ts`
- Create: `scripts/validate-release.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `deploy/ci-smoke.test.sh`

- [ ] **Step 1: Write failing release-gate tests**

Test first release, malformed tag, prerelease/build tag, package mismatch, lockfile mismatch, malformed latest tag, equal/lower latest, and a strictly higher patch/minor/major release. The CLI accepts only validated `--tag` and `--latest-tag` arguments and reads package/lock JSON with `JSON.parse`.

- [ ] **Step 2: Run tests and confirm RED**

```bash
npx vitest run scripts/validate-release.test.ts
```

Expected: FAIL because the validator is missing.

- [ ] **Step 3: Implement the release validator**

Export `validateRelease({ tag, latestTag, packageVersion, lockVersion })`. Require strict `vMAJOR.MINOR.PATCH`, exact `v${packageVersion}`, package/lock equality, and `semver.gt(newVersion, latestVersion)` when latest exists. The CLI prints one sanitized success line and exits nonzero on every mismatch. Add `"release:validate": "node --import tsx scripts/validate-release.ts"`.

- [ ] **Step 4: Extend CI to tags and exact Docker metadata**

Add `push.tags: ["v*"]`. In the existing CI job, tag runs query the latest stable Release with `gh release list`, run `npm run release:validate -- --tag "$GITHUB_REF_NAME" --latest-tag "$latest_tag"` before quality gates, and build Docker with package version/full `$GITHUB_SHA`. Keep `contents: read` for CI.

- [ ] **Step 5: Add the serialized release job**

Create a tag-only `release` job with `needs: ci`, `contents: write`, and `concurrency.group: stable-release-${{ github.repository_id }}`. Re-check monotonicity under the lock, require the remote peeled tag commit to equal `$GITHUB_SHA`, require the commit in `origin/main` ancestry after an explicit fetch, reject an existing same-tag Release, then create a draft and publish it stable/latest:

```bash
gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \
  --verify-tag --generate-notes --fail-on-no-commits \
  --title "$GITHUB_REF_NAME" --draft
gh release edit "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \
  --verify-tag --draft=false --latest
```

An error trap may delete only a still-draft release created by that job. Final `gh release view` must assert the tag, `isDraft=false`, `isPrerelease=false`, and `isLatest=true`. No workflow or implementation command creates or pushes a tag.

- [ ] **Step 6: Add static workflow contracts and commit**

Extend `deploy/ci-smoke.test.sh` to assert tag validation precedes every gate, release needs CI, write permission is release-job-only, exact commit checks precede draft creation, draft precedes publication, and `pull_request_target` is absent.

```bash
npx vitest run scripts/validate-release.test.ts
bash deploy/ci-smoke.test.sh
git add scripts/validate-release.ts scripts/validate-release.test.ts package.json package-lock.json .github/workflows/ci.yml deploy/ci-smoke.test.sh
git commit -m "ci: publish validated stable releases"
```

Expected: PASS.

### Task 11: Document, Visually Verify, and Run Full Acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/dev/00-overview.md`
- Modify: `docs/dev/01-architecture.md`
- Modify: `docs/dev/09-admin.md`
- Modify: `docs/dev/10-ops-test.md`
- Modify: `docs/dev/deploy.md`
- Modify: `docs/dev/README.md`
- Modify: `docs/PROGRESS.md`
- Create: `tests/e2e/system-update.spec.ts`

- [ ] **Step 1: Update operational and admin documentation**

Document the fixed official stable channel, `/admin/system-update`, one-time bootstrap, prerequisites (`git`, `jq`, Docker Compose v2, systemd), control-directory permissions, exact status/recovery commands, maintenance behavior, no Docker socket in Web, tag/version publication steps, immutable-release/tag-ruleset recommendation, and Debian update/recovery drill.

The existing deployment bootstrap remains exactly:

```bash
git pull --ff-only
sudo bash deploy/install.sh --upgrade
```

State clearly that no Release is created by local implementation and future one-click updates begin only after this version is manually bootstrapped.

- [ ] **Step 2: Add a guarded Playwright admin visual test**

The test logs in with disposable admin credentials, intercepts `/api/admin/system-update` and `/api/admin/system-update/check` with strict response fixtures, opens `/admin/system-update`, and captures desktop `1440x900` plus mobile `390x844` screenshots for disabled, update-available, active/disconnected, and recovery-required states. It must assert no horizontal overflow, no overlapping nav/page text, command wrapping, dialog accessibility, and the validated external release link. Do not add a production path override for fixtures. Gate the test behind `E2E_SYSTEM_UPDATE_ENABLED=true` so it never targets production.

- [ ] **Step 3: Run focused Web verification**

```bash
npx vitest run src/contracts/system-update.test.ts src/server/system-update app/root.maintenance.test.ts app/routes/api.admin.system-update.test.ts app/routes/api.admin.system-update.check.test.ts app/routes/_admin.system-update.test.tsx app/routes/_admin.test.tsx scripts/validate-release.test.ts
npm run typecheck
npm run build
npm run assert-no-secrets
```

Expected: PASS; build client contains no deployment paths, status internals, GitHub payload, or secret values.

- [ ] **Step 4: Run deployment verification**

```bash
npm run docker:validate
npm run test:deploy
docker build --build-arg APP_VERSION=0.2.0 --build-arg APP_COMMIT_SHA="$(git rev-parse HEAD)" --tag ai-image-workshop:acceptance .
IMAGE_TAG=acceptance npm run test:deploy:smoke
```

Expected: PASS; Web has inbox RW/state RO, worker/scheduler have neither, and no app container mounts Docker Socket or the project root.

- [ ] **Step 5: Run the full unit suite**

```bash
npm run test:run
```

Expected: no failed suites.

- [ ] **Step 6: Perform Playwright visual QA**

Start the disposable PostgreSQL/UI environment, seed the test admin, and use Playwright route interception for updater status/check responses, then run:

```bash
E2E_SYSTEM_UPDATE_ENABLED=true npm run test:e2e -- tests/e2e/system-update.spec.ts
```

Inspect all generated desktop/mobile screenshots and iterate until text, controls, sidebar/drawer, dialog, phases, and commands have no overlap or clipping.

- [ ] **Step 7: Run a Debian update and recovery drill**

On a disposable Debian host, install the old stable fixture, bootstrap the updater, publish/use a local test-mode higher fixture Release, and verify: drain, backup, exact tag, migration, restart, status persistence, PostgreSQL/media retention, migration-boundary failure, `status REQUEST_ID`, visible recovery confirmation, database-only restore, old-image health, and no secret output. Production mode must still reject repository/URL/path overrides.

- [ ] **Step 8: Inspect final changes and commit docs/verification fixes**

```bash
git status --short
git diff --check
git diff --stat b3f309e..HEAD
```

Commit only files in this plan:

```bash
git add README.md docs/dev docs/PROGRESS.md tests/e2e/system-update.spec.ts
git commit -m "docs: document admin system updates"
```

If verification required scoped fixes, commit those files separately with `fix: close system update verification gaps`. Do not create or push a Git tag and do not create a GitHub Release from this implementation session.
