# System Updater Request Validation Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `v0.2.2` with correct host request validation and a visible accepted-but-waiting admin state, then safely recover and update production.

**Architecture:** Keep the existing protocol and guarded updater pipeline. Fix only the jq stream aggregation boundary, cover it through the real shell entry point, and make the browser's stored request ID an explicit pending state until the host publishes a matching phase. Bootstrap only the verified updater script before rerunning the normal production update.

**Tech Stack:** Bash, jq, systemd, React 19, React Router 8, Vitest, Testing Library, Docker Compose, GitHub Actions/GitHub Release

---

### Task 1: Capture The Regression In Shell

**Files:**
- Create: `deploy/ai-image-workshop-update.test.sh`
- Modify: `package.json`

- [ ] **Step 1: Write a real process-request regression test**

Create a temporary project/control root, strict config and deploy environment, one
valid request/reservation pair, and fake `curl`, `docker`, and `git` commands. Invoke:

```bash
AI_IMAGE_WORKSHOP_UPDATE_TEST_MODE=1 \
AI_IMAGE_WORKSHOP_UPDATE_CONFIG="$config_path" \
bash "$UPDATER" process-request
```

The fake `curl` returns failure after claim. Assert that `status.json` contains the
request ID, `phase == "failed"`, `errorCode == "RELEASE_CHECK_FAILED"`, and that the
inbox request/reservation were consumed. This proves the valid request passed the
duplicate-key check and entered the normal failure handler.

- [ ] **Step 2: Add the focused shell test to the deployment test command**

Change `test:deploy` to begin with:

```json
"test:deploy": "bash deploy/ai-image-workshop-update.test.sh && bash deploy/install-lib.test.sh ..."
```

- [ ] **Step 3: Run the shell test and verify RED**

Run in a disposable Debian container with jq and util-linux installed:

```powershell
docker run --rm -v "${PWD}:/repo" -w /repo debian:bookworm \
  bash -lc "apt-get update -qq && apt-get install -y -qq jq util-linux && bash deploy/ai-image-workshop-update.test.sh"
```

Expected: FAIL because the current updater rejects the valid request before publishing
`status.json`.

### Task 2: Fix Host Validation

**Files:**
- Modify: `deploy/ai-image-workshop-update`
- Test: `deploy/ai-image-workshop-update.test.sh`

- [ ] **Step 1: Aggregate request stream events**

Change the request duplicate-key validation from:

```bash
jq --stream -e '
```

to:

```bash
jq --stream --slurp -e '
```

and iterate the slurped events:

```jq
[.[] | select(length == 2 and (.[0] | length) == 1) | .[0][0]] as $keys |
($keys | length) == 4 and ($keys | unique | length) == 4
```

- [ ] **Step 2: Apply the same aggregation to reservation validation**

Use the same slurped event expression in `validate_reservation`; keep all existing
schema, UUID, timestamp, expiry, link, and path checks unchanged.

- [ ] **Step 3: Run the focused shell test and verify GREEN**

Run the same disposable Debian command. Expected: PASS with the request reaching the
controlled `RELEASE_CHECK_FAILED` terminal state.

### Task 3: Capture The Silent Admin State

**Files:**
- Create: `app/routes/_admin.system-update.test.tsx`

- [ ] **Step 1: Write the accepted-but-idle UI test**

Mock `apiGet` to return an enabled `0.2.1` snapshot whose host status is `idle`, place
a valid request ID in `sessionStorage`, render `SystemUpdatePage`, and assert that the
page shows:

```text
更新请求已提交，等待主机更新器接收
```

along with the stored request ID. Also assert that the update button remains disabled.

- [ ] **Step 2: Run the single UI test and verify RED**

```powershell
npm run test:run -- app/routes/_admin.system-update.test.tsx
```

Expected: FAIL because the current progress band ignores stored requests while host
status is `idle`.

### Task 4: Render Accepted-But-Idle Progress

**Files:**
- Modify: `app/routes/_admin.system-update.tsx`
- Test: `app/routes/_admin.system-update.test.tsx`

- [ ] **Step 1: Derive the host-claim waiting state**

Add a boolean that is true when a browser request ID exists but the host has not
published that same request in a non-idle phase:

```ts
const awaitingHostClaim = Boolean(
  storedRequestId &&
    (!status || status.requestId !== storedRequestId || status.phase === "idle"),
);
```

- [ ] **Step 2: Render the pending progress band**

Before the normal host progress band, render a loader, the pending title, and the
stored request ID. Do not clear the ID or stop polling. Do not report success or
failure while the host is still idle.

- [ ] **Step 3: Run the single UI test and verify GREEN**

```powershell
npm run test:run -- app/routes/_admin.system-update.test.tsx
```

Expected: PASS.

### Task 5: Prepare Release 0.2.2

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/dev/09-admin.md`
- Modify: `docs/dev/deploy.md`
- Modify: `docs/superpowers/specs/2026-07-12-github-release-admin-updater-design.md`
- Modify: `docs/superpowers/specs/2026-07-14-system-updater-validation-hotfix-design.md`

- [ ] **Step 1: Bump package metadata**

Set the root package and lockfile versions to `0.2.2` without changing dependency
versions.

- [ ] **Step 2: Record the incident and fixed behavior**

Document the validated jq root cause, accepted-but-idle UI state, focused regression
coverage, release status, and one-time production bootstrap. Do not change unrelated
requirements or deployment history.

- [ ] **Step 3: Run the single final verification gate**

Run the focused tests plus release checks once:

```powershell
npm run test:run -- app/routes/_admin.system-update.test.tsx app/routes/api.admin.system-update.test.ts app/routes/api.admin.system-update.check.test.ts src/server/system-update src/contracts/system-update.test.ts
npm run typecheck
npm run build
npm run assert-no-secrets
npm run docker:validate
npm run release:validate -- --expected-version 0.2.2
```

Run the updater shell regression in the disposable Debian container once as part of
this final gate. Every command must exit 0.

### Task 6: Publish v0.2.2

**Files:**
- No additional file changes

- [ ] **Step 1: Commit and push the feature branch**

Stage only the hotfix, tests, version metadata, and related documents. Commit with:

```text
fix: recover guarded system updates
```

Push `codex/admin-system-updater`.

- [ ] **Step 2: Fast-forward and push main**

Verify `github/main` is an ancestor of the release commit, then push the exact commit
to `main` without merging unrelated work.

- [ ] **Step 3: Create and push the annotated release tag**

Create `v0.2.2` at the release commit and push it. Wait for both the tag CI and release
jobs to succeed, then verify the GitHub Release is stable and marked Latest.

### Task 7: Recover And Update Production

**Files:**
- Production host fixed paths only; no repository edits

- [ ] **Step 1: Stop the failed updater loop and reverify identity**

Stop `ai-image-workshop-update.path` and `ai-image-workshop-update.service`. Re-read
`status.json`, the inbox request, reservation token, installed version, and public
health. Continue only when they match the captured `0.2.0` idle incident and the site
is healthy.

- [ ] **Step 2: Install only the verified v0.2.2 updater entry point**

Fetch the official annotated `v0.2.2` tag into a temporary ref, verify the peeled
commit and both package versions, save the current updater, extract the tag's
`deploy/ai-image-workshop-update` into a root-owned temporary file, and install it at
`/usr/local/sbin/ai-image-workshop-update` with mode `0755`.

- [ ] **Step 3: Clear only the expired incident request**

Delete the exact request file and exact matching expired token, remove the now-empty
reservation directory, run `ai-image-workshop-update initialize`, reset the failed
service state, and start the path unit. Verify public state is clean `idle/0.2.0`.

- [ ] **Step 4: Start the authenticated update and monitor completion**

Use `/admin/system-update` to check and start the Latest release. Monitor
`status.json`, systemd, containers, and `/healthz` until the host publishes
`completed/currentVersion=0.2.2/maintenance=false` or a real terminal failure.

### Task 8: Production Acceptance

**Files:**
- No file changes

- [ ] **Step 1: Verify runtime identity and health**

Check the public 204 health response, deployed build version/commit, healthy Compose
services, inactive oneshot updater, and active path unit.

- [ ] **Step 2: Verify the delivered user behavior**

Confirm the deployed conversation asset contains `sourceImageId` and the edit action,
then use the authenticated UI to verify a successful conversation result card exposes
"编辑图片" and enters the Composer edit state without changing the source image.

- [ ] **Step 3: Record production completion**

Update the hotfix design and progress/deploy documentation with the actual release
commit, tag workflow result, production backup ID, final status, and health evidence;
commit and push this evidence only after production verification.

