# Documentation Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every discoverable project document describe the implemented `0.2.0` baseline, the verified Tencent production deployment, and the exact boundary between completed functionality and an unpublished GitHub Release.

**Architecture:** Keep detailed technical references in place, but give every current entry point one consistent status vocabulary: implemented, deployed, verified, or not yet published. Replace the two long unchecked implementation plans with compact completion records, update the remaining specifications and records in place, and validate links and stale-state language across all Markdown files.

**Tech Stack:** Markdown, PowerShell, ripgrep, Git.

**Design:** `docs/superpowers/specs/2026-07-13-documentation-closure-design.md`

---

### Task 1: Close Project Entry Points and Product Status

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/development.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/requirements.md`
- Modify: `docs/test-cases.md`
- Modify: `docs/prototypes/README.md`

- [x] **Step 1: Add one consistent release/deployment summary**

Use these exact facts wherever the file owns current status:

```text
产品版本：0.2.0
生产提交：c5131aaa0335250a3846c380519324fbbf4b231b
生产地址：https://one-image2.tangguo.xin
后台更新入口：/admin/system-update
功能状态：现有需求已实现，腾讯云生产环境已部署并通过健康检查
发布状态：GitHub main、v0.2.0 tag 与 stable/latest Release 尚未发布
```

Keep `docs/PROGRESS.md` as the detailed status source. Other entry points link to it instead of duplicating the entire deployment log.

- [x] **Step 2: Separate completed requirements from recurring operations**

Replace headings such as `仍需人工验收` with `持续运维与发布动作`. Keep real Relay checks, off-host encrypted backups, restore drills, monitoring, and high availability as recurring or future operations, not as unfinished product requirements.

- [x] **Step 3: Archive obsolete entry points cleanly**

Make `docs/requirements.md`, `docs/test-cases.md`, and prototype documentation state that their historical material is closed and point readers to the current requirements, development index, operations checks, and production runbook.

- [x] **Step 4: Review and commit the entry-point batch**

Run:

```powershell
rg -n "production rollout pending|仍需人工验收|待实现|尚未实现|0\.1\.0" README.md CLAUDE.md docs/development.md docs/PROGRESS.md docs/requirements.md docs/test-cases.md docs/prototypes/README.md
git diff --check
```

Expected: no stale implementation status; any remaining “尚未” text refers only to GitHub Release publication or explicitly recurring operations.

Commit:

```powershell
git add README.md CLAUDE.md docs/development.md docs/PROGRESS.md docs/requirements.md docs/test-cases.md docs/prototypes/README.md
git commit -m "docs: close project status and entry points"
```

### Task 2: Align Current Requirements, Development, and Operations Guides

**Files:**
- Modify: `docs/redesign-requirements.md`
- Modify: `tasks/prd-user-api-key-modes.md`
- Modify: `docs/dev/README.md`
- Modify: `docs/dev/00-overview.md`
- Modify: `docs/dev/01-architecture.md`
- Modify: `docs/dev/04-generation-pipeline.md`
- Modify: `docs/dev/09-admin.md`
- Modify: `docs/dev/10-ops-test.md`
- Modify: `docs/dev/deploy.md`
- Modify: `docs/dev/local-acceptance.md`
- Modify: `docs/dev/cost-reconciliation.md`
- Modify: `docs/dev/11-structure-roadmap.md`
- Modify: `docs/dev/INSPIRATION-UGC-PLAN.md`

- [x] **Step 1: Close the current requirements baseline**

State at the top of the product specification and API-key PRD that all requirements in those documents are implemented in `0.2.0`. Preserve rule details as the current contract. Describe production Relay checks as periodic acceptance rather than missing implementation.

- [x] **Step 2: Record the deployed runtime and updater**

Use the following operational evidence in `docs/dev/00-overview.md`, `docs/dev/09-admin.md`, `docs/dev/10-ops-test.md`, and `docs/dev/deploy.md`:

```text
Deployment date: 2026-07-13
Backup: deploy/backups/20260713T145807Z
Containers: postgres, web, worker, scheduler running
Health: local and public /healthz returned 204
Updater: ai-image-workshop-update.path enabled/active; service enabled
Admin route without a session: 302 to login
```

- [x] **Step 3: Remove the obsolete Debian workaround**

Delete the `INSTALL_OS_RELEASE_FILE=/usr/lib/os-release` workaround from `docs/dev/deploy.md`. Replace it with one sentence that Debian's standard `/etc/os-release -> /usr/lib/os-release` link is supported since commit `c5131aa`; unreadable or broken paths remain errors.

- [x] **Step 4: Clarify publication and one-click update sequencing**

Document that the updater code is installed and idle, but the first official one-click update requires a strictly higher stable Release after `0.2.0` is merged to GitHub `main` and published as the baseline Release. Do not claim that `v0.2.0` already exists.

- [x] **Step 5: Reclassify remaining operational work**

Keep cost observation, real-provider checks, encrypted off-host backups, restore drills, monitoring, credential rotation, and high availability under recurring operations or optional enhancements. Remove wording that treats them as missing implementation requirements.

- [x] **Step 6: Review and commit the current-document batch**

Run:

```powershell
rg -n "INSTALL_OS_RELEASE_FILE|production rollout pending|真实 Relay.*仍|目标服务器.*验收|待实现|尚未实现" docs/redesign-requirements.md tasks/prd-user-api-key-modes.md docs/dev
git diff --check
```

Expected: the environment override is absent; remaining Relay references are explicitly periodic acceptance; no current requirement is presented as unimplemented.

Commit:

```powershell
git add docs/redesign-requirements.md tasks/prd-user-api-key-modes.md docs/dev
git commit -m "docs: align implemented requirements and operations"
```

### Task 3: Convert Historical Specifications and Plans to Completion Records

**Files:**
- Modify: `docs/superpowers/plans/2026-05-10-ai-image-workshop.md`
- Modify: `docs/superpowers/plans/2026-07-11-debian-docker-deployment.md`
- Modify: `docs/superpowers/plans/2026-07-11-user-api-key-modes.md`
- Modify: `docs/superpowers/plans/2026-07-12-self-hosted-one-command-deployment.md`
- Modify: `docs/superpowers/plans/2026-07-12-github-release-admin-updater.md`
- Modify: `docs/superpowers/specs/2026-05-10-ai-image-workshop-design.md`
- Modify: `docs/superpowers/specs/2026-07-11-debian-docker-deployment-design.md`
- Modify: `docs/superpowers/specs/2026-07-12-self-hosted-one-command-deployment-design.md`
- Modify: `docs/superpowers/specs/2026-07-12-github-release-admin-updater-design.md`

- [x] **Step 1: Replace the two unchecked implementation plans**

Rewrite the self-hosted deployment and admin-updater plans as compact implementation records. Each record contains:

```markdown
Status: completed and deployed on 2026-07-13.

## Delivered

- [x] Final user-visible and operational outcomes.

## Production Evidence

- Version, commit, backup, container health, and updater state.

## Publication Boundary

- GitHub main/tag/Release state without claiming publication.

## Ongoing Operations

- Recurring checks and optional infrastructure enhancements.
```

Do not retain unexecuted test-file creation steps or empty checkboxes as if they were future product work. Name final artifacts that actually exist, including `deploy/ai-image-workshop-update`, `scripts/validate-release.ts`, admin routes, contracts, systemd units, and the release workflow.

- [x] **Step 2: Close the shorter implementation records**

Update the Debian and API-key records to `completed and deployed`. Move credential rotation, live provider smoke, rollback drills, and monitoring from `Still Required` to `Ongoing Operations`; do not mark those recurring actions as already performed when there is no evidence.

- [x] **Step 3: Add completion headers to specifications**

Each active specification gets a status line saying its scoped requirements are implemented in `0.2.0`. The v1 design is marked completed and superseded. The deployment and updater designs link to current operations documentation and record the 2026-07-13 production deployment.

- [x] **Step 4: Verify no historical implementation plan remains open**

Run:

```powershell
rg -n "^- \[ \]|Status:.*pending|状态：已批准$|状态：用户已确认" docs/superpowers/plans docs/superpowers/specs -g "!2026-07-13-documentation-closure.md"
```

Expected: no unchecked implementation checkbox or pending/approval-only status remains. The documentation-closure plan itself is excluded until Task 4 marks it complete.

- [x] **Step 5: Commit the historical-document batch**

```powershell
git add docs/superpowers/plans docs/superpowers/specs
git commit -m "docs: close historical specifications and plans"
```

### Task 4: Run One Cross-Documentation Verification and Close This Plan

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-documentation-closure.md`

- [x] **Step 1: Scan status, version, and workaround consistency**

Run:

```powershell
rg -n "0\.1\.0|production rollout pending|^- \[ \]|INSTALL_OS_RELEASE_FILE|状态：已批准$|状态：用户已确认|待实现|尚未实现|仍需人工验收" README.md CLAUDE.md tasks docs
rg -n "0\.2\.0|c5131aaa0335250a3846c380519324fbbf4b231b|20260713T145807Z|/admin/system-update" README.md CLAUDE.md tasks docs
```

Expected: stale scan is empty except this plan's own unchecked tracking before completion and any sentence explicitly stating the GitHub Release is not yet published. Required facts appear in their owning status and operations documents.

- [x] **Step 2: Validate every local Markdown link**

Run:

```powershell
$errors = @()
Get-ChildItem -Recurse -File -Filter *.md | ForEach-Object {
  $source = $_
  $content = Get-Content -Raw -LiteralPath $source.FullName
  [regex]::Matches($content, '\[[^\]]*\]\(([^)]+)\)') | ForEach-Object {
    $target = $_.Groups[1].Value.Split('#')[0]
    if ($target -and $target -notmatch '^(https?://|mailto:|/)') {
      $resolved = Join-Path $source.DirectoryName ([uri]::UnescapeDataString($target))
      if (-not (Test-Path -LiteralPath $resolved)) { $errors += "$($source.FullName): $target" }
    }
  }
}
if ($errors.Count) { $errors; throw 'Broken Markdown links' }
```

Expected: exit code `0` with no broken local links.

- [x] **Step 3: Mark this plan complete and perform final Git checks**

Change every checkbox in this file to `[x]`, then run:

```powershell
git diff --check
git status --short
git diff --stat bcae3e5..HEAD
```

Expected: only intended Markdown changes, no application code or production configuration changes, and no whitespace errors.

- [x] **Step 4: Commit the completed plan**

```powershell
git add docs/superpowers/plans/2026-07-13-documentation-closure.md
git commit -m "docs: complete documentation closure"
```
