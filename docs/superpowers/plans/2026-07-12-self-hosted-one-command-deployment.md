# Self-Hosted One-Command Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh Debian server able to run the complete application with one Docker Compose stack, local PostgreSQL, persistent local media, a visible three-value installer, administrator bootstrap, and tested backup/restore.

**Architecture:** Keep the existing React Router web process, worker, scheduler, Better Auth, transaction model, and S3-compatible adapter. Add explicit `pg` and `local` production drivers, then compose them with private PostgreSQL and named volumes. A Bash installer owns preflight checks, secret generation, migrations, transient administrator creation, and health verification; Caddy is enabled only for the bundled-domain mode.

**Tech Stack:** Node.js 22, TypeScript, React Router 8, Vitest, `pg`, PostgreSQL 17, Docker Engine/Compose, Bash, Caddy 2, GitHub Actions.

---

## Delivery Boundary

This is one integrated deployment project rather than separate database/storage/operations projects: no intermediate subset is independently deployable. Each task still ends in a passing test and a focused commit. Existing Neon and S3-compatible support stays available for development or future external deployments; the new installer selects PostgreSQL and local media explicitly.

## File Map

**Create**

- `app/routes/media.$.ts`: authenticated-independent, read-only local media response route.
- `app/routes/media.$.test.ts`: route success, missing-object, disabled-driver, and traversal tests.
- `deploy/install-lib.sh`: pure validation, input, quoting, port-selection, and configuration helpers.
- `deploy/install-lib.test.sh`: shell-level unit tests for the installer helpers.
- `deploy/install.sh`: Debian preflight, initial install, resume, and upgrade entry point.
- `deploy/install.test.sh`: fake-Docker orchestration tests that prove ordering and secret handling.
- `deploy/backup.sh`: consistent PostgreSQL/media backup with checksums and retention.
- `deploy/restore.sh`: guarded restore into stopped, empty application volumes.
- `deploy/backup-restore.test.sh`: fake-Docker guard and command-contract tests.
- `deploy/ci-smoke.sh`: real Compose empty-install and persistence smoke for GitHub Actions.

**Modify**

- `src/db/db.server.ts`: select reusable standard `pg` pools with `DATABASE_DRIVER=pg`.
- `src/db/db.server.test.ts`: verify driver selection, pool reuse, parameterization, and shutdown.
- `src/server/local-storage.server.ts`: generalize local storage for production and emit `/media/*` URLs.
- `src/server/r2.server.ts`: use the generalized local-storage switch for every operation.
- `src/server/r2.server.local.test.ts`: cover production local mode and complete object lifecycle.
- `app/routes.ts`: replace the disposable query route with `/media/*`.
- `compose.yaml`: add PostgreSQL, persistent volumes, loopback port publishing, and optional Caddy.
- `deploy/Caddyfile`: serve immutable media directly and proxy all other requests.
- `deploy/.env.production.example`: document self-hosted defaults without real secrets.
- `Dockerfile`: create the media mount point with the correct runtime ownership.
- `package.json`: add deployment shell test and smoke commands.
- `.gitignore`: exclude generated deployment state and backups.
- `.dockerignore`: exclude generated deployment state and backups from image context.
- `.github/workflows/ci.yml`: run shell contract tests and a real empty-stack smoke.
- `docs/dev/deploy.md`: concise Debian install, proxy, backup, restore, and upgrade runbook.
- `docs/dev/01-architecture.md`: record the self-hosted production topology.
- `docs/dev/02-database.md`: record driver selection and local PostgreSQL ownership.
- `docs/dev/06-storage.md`: record local-media behavior and relative URL contract.
- `docs/dev/10-ops-test.md`: record deployment acceptance and recovery checks.
- `docs/PROGRESS.md`: mark the self-hosted deployment milestone complete without adding a long diary.

**Delete**

- `app/routes/api.local-storage.ts`: remove the disposable-only query-string media endpoint after `/media/*` replaces it.

### Task 1: Add an Explicit PostgreSQL Production Driver

**Files:**

- Modify: `src/db/db.server.ts`
- Modify: `src/db/db.server.test.ts`

- [ ] **Step 1: Add failing tests for explicit `pg` selection and reusable pools**

Add a hoisted `pg` mock and these cases to `src/db/db.server.test.ts`. Preserve the existing Neon lifecycle test.

```ts
const pgMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(async () => {}),
  query: vi.fn(async () => ({ rows: [{ value: "ok" }], rowCount: 1 })),
  constructors: [] as Array<Record<string, unknown>>,
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: Record<string, unknown>) {
      pgMocks.constructors.push(options);
    }
    connect = pgMocks.connect;
    end = pgMocks.end;
    query = pgMocks.query;
  },
}));

it("uses reusable pg pools when DATABASE_DRIVER=pg", async () => {
  process.env.DATABASE_DRIVER = "pg";
  const { closeDbPools, getPool, getSql } = await import("./db.server");

  expect(getPool()).toBe(getPool());
  const sql = getSql();
  await sql`SELECT ${"ok"} AS value`;

  expect(pgMocks.constructors).toEqual([
    expect.objectContaining({ connectionString: "postgres://transaction", max: 4 }),
    expect.objectContaining({ connectionString: "postgres://read", max: 4 }),
  ]);
  expect(pgMocks.query).toHaveBeenCalledWith("SELECT $1 AS value", ["ok"]);

  await closeDbPools();
  expect(pgMocks.end).toHaveBeenCalledTimes(2);
});

it("keeps the disposable pg flag compatible", async () => {
  process.env.DISPOSABLE_TEST_DB_DRIVER = "pg";
  const { usesPgDriver } = await import("./db.server");
  expect(usesPgDriver()).toBe(true);
});
```

In `beforeEach`, reset `pgMocks`, delete `DATABASE_DRIVER`, and keep both test database URLs assigned. In `afterEach`, import and call `closeDbPools()` before restoring mocks so a failed assertion cannot leak a pool into the next case.

- [ ] **Step 2: Run the focused test and confirm the new contract fails**

Run: `npx vitest run src/db/db.server.test.ts`

Expected: FAIL because `usesPgDriver` is not exported and `DATABASE_DRIVER=pg` still constructs the Neon pool.

- [ ] **Step 3: Implement driver selection and cached standard pools**

Replace `usesDisposableLocalPostgres`, `getLocalReadPool`, and the current pool state with this exact structure in `src/db/db.server.ts`:

```ts
export function usesPgDriver(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DATABASE_DRIVER === "pg" || env.DISPOSABLE_TEST_DB_DRIVER === "pg";
}

let readPool: PgPool | undefined;
let transactionPool: DbPool | undefined;

function createPgPool(connectionString: string): PgPool {
  return new PgPool({ connectionString, allowExitOnIdle: true, max: 4 });
}

function getPgReadPool(): PgPool {
  readPool ??= createPgPool(requireEnv("DATABASE_URL"));
  return readPool;
}

export function getPool(): DbPool {
  transactionPool ??= usesPgDriver()
    ? (createPgPool(requireEnv("DATABASE_URL_UNPOOLED")) as unknown as DbPool)
    : (new Pool({ connectionString: requireEnv("DATABASE_URL_UNPOOLED") }) as unknown as DbPool);
  return transactionPool;
}

export async function closeDbPools(): Promise<void> {
  const pools = [transactionPool, readPool].filter(Boolean) as Array<{ end(): Promise<void> }>;
  transactionPool = undefined;
  readPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}
```

Use this standard-pool branch inside `getSql()`; retain the existing Neon branch unchanged:

```ts
if (usesPgDriver()) {
  const pool = getPgReadPool();
  return (async (strings: TemplateStringsArray, ...values: any[]) => {
    let queryText = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      queryText += `$${index + 1}${strings[index + 1] ?? ""}`;
    }
    const result = await pool.query(queryText, values);
    return result.rows;
  }) as SqlClient;
}
```

- [ ] **Step 4: Run database unit tests and type checking**

Run: `npx vitest run src/db/db.server.test.ts && npm run typecheck`

Expected: both commands exit 0; the focused suite reports all database lifecycle cases passing.

- [ ] **Step 5: Commit the database driver**

```bash
git add src/db/db.server.ts src/db/db.server.test.ts
git commit -m "feat: add self-hosted postgres driver"
```

### Task 2: Generalize Local Media Storage for Production

**Files:**

- Modify: `src/server/local-storage.server.ts`
- Modify: `src/server/r2.server.ts`
- Modify: `src/server/r2.server.local.test.ts`

- [ ] **Step 1: Add failing production-local storage tests**

Update the test environment in `src/server/r2.server.local.test.ts` to save and restore `STORAGE_DRIVER` and `LOCAL_STORAGE_ROOT`. Add this case while retaining the write/read/delete and symlink cases:

```ts
it("uses relative media URLs with the explicit local driver", async () => {
  delete process.env.DISPOSABLE_TEST_DB_DRIVER;
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_ROOT = directory;

  const result = await putToR2("user id", "generation-id", {
    b64_json: ONE_PIXEL_PNG.toString("base64"),
  });

  expect(result.publicUrl).toMatch(/^\/media\/user%20id\//);
  expect(storageKeyFromPublicUrl(`https://images.example${result.publicUrl}`)).toBe(
    result.storageKey,
  );
  expect(Buffer.from((await getUploadObject(result.storageKey)).bytes)).toEqual(ONE_PIXEL_PNG);
});
```

Also extend the lifecycle case to call `listStorageObjects()` and `deleteManyFromR2()` and assert that only the requested keys disappear.

- [ ] **Step 2: Run the focused suite and confirm it fails**

Run: `npx vitest run src/server/r2.server.local.test.ts`

Expected: FAIL because `STORAGE_DRIVER=local` is ignored and the current URL is absolute `/api/local-storage?key=`.

- [ ] **Step 3: Implement the production switch, root, and relative URL contract**

Replace the exported switch and `storageRoot()` in `src/server/local-storage.server.ts` with:

```ts
export function isLocalStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STORAGE_DRIVER === "local" || env.DISPOSABLE_TEST_DB_DRIVER === "pg";
}

function storageRoot(): string {
  return resolve(
    process.env.LOCAL_STORAGE_ROOT ||
      process.env.LOCAL_TEST_STORAGE_ROOT ||
      resolve(process.cwd(), ".local-test-storage"),
  );
}
```

Replace both URL functions with segment-safe relative paths:

```ts
export function localStoragePublicUrl(storageKey: string): string {
  return `/media/${storageSegments(storageKey).map(encodeURIComponent).join("/")}`;
}

export function storageKeyFromLocalPublicUrl(value: string): string | null {
  try {
    const url = new URL(value, "http://local.invalid");
    if (!url.pathname.startsWith("/media/")) return null;
    const encodedKey = url.pathname.slice("/media/".length);
    const key = encodedKey.split("/").map(decodeURIComponent).join("/");
    storagePath(key);
    return key;
  } catch {
    return null;
  }
}
```

In `src/server/r2.server.ts`, rename the import to `isLocalStorageEnabled` and replace every `isLocalTestStorageEnabled()` condition with `isLocalStorageEnabled()`. Do not change S3 request construction or public URL parsing in the external-driver branch.

- [ ] **Step 4: Run local-storage, R2, and type tests**

Run: `npx vitest run src/server/r2.server.local.test.ts src/server/r2.server.test.ts && npm run typecheck`

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the production local-media adapter**

```bash
git add src/server/local-storage.server.ts src/server/r2.server.ts src/server/r2.server.local.test.ts
git commit -m "feat: support persistent local media storage"
```

### Task 3: Serve Local Media Through `/media/*`

**Files:**

- Create: `app/routes/media.$.ts`
- Create: `app/routes/media.$.test.ts`
- Modify: `app/routes.ts`
- Delete: `app/routes/api.local-storage.ts`
- Modify: `src/server/r2.server.local.test.ts`

- [ ] **Step 1: Write failing media-route tests**

Create `app/routes/media.$.test.ts` with a temporary local root and these behaviors:

```ts
// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLocalStorageObject } from "../../src/server/local-storage.server";
import { loader } from "./media.$";

describe("GET /media/*", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "media-route-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_ROOT = directory;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    delete process.env.STORAGE_DRIVER;
    delete process.env.LOCAL_STORAGE_ROOT;
  });

  it("returns immutable media bytes", async () => {
    await writeLocalStorageObject("users/a file.png", new Uint8Array([1, 2, 3]));
    const response = await loader({
      request: new Request("https://app.example/media/users/a%20file.png"),
      params: { "*": "users/a file.png" },
      context: {},
    } as Parameters<typeof loader>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([
    "https://app.example/media/missing.png",
    "https://app.example/media/%2e%2e/secret.png",
  ])("returns 404 for %s", async (url) => {
    const response = await loader({
      request: new Request(url),
      params: {},
      context: {},
    } as Parameters<typeof loader>[0]);
    expect(response.status).toBe(404);
  });
});
```

Add a fourth case that deletes `STORAGE_DRIVER` and expects 404 even when a file exists.

- [ ] **Step 2: Run the route test and confirm the module is missing**

Run: `npx vitest run 'app/routes/media.$.test.ts'`

Expected: FAIL because `app/routes/media.$.ts` does not exist.

- [ ] **Step 3: Implement and register the media route**

Create `app/routes/media.$.ts`:

```ts
import { httpError } from "../../src/contracts/error";
import {
  isLocalStorageEnabled,
  readLocalStorageObject,
  storageKeyFromLocalPublicUrl,
} from "../../src/server/local-storage.server";
import type { Route } from "./+types/media.$";

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (!isLocalStorageEnabled()) return httpError(404, "NOT_FOUND", "Resource not found");
  const storageKey = storageKeyFromLocalPublicUrl(request.url);
  if (!storageKey) return httpError(404, "NOT_FOUND", "Resource not found");
  try {
    const object = await readLocalStorageObject(storageKey);
    const body = object.bytes.buffer.slice(
      object.bytes.byteOffset,
      object.bytes.byteOffset + object.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return httpError(404, "NOT_FOUND", "Resource not found");
  }
}
```

In `app/routes.ts`, replace:

```ts
route("api/local-storage", "routes/api.local-storage.ts"),
```

with:

```ts
route("media/*", "routes/media.$.ts"),
```

Delete `app/routes/api.local-storage.ts`. In `src/server/r2.server.local.test.ts`, import the new loader and request the returned relative URL against `http://localhost:8888`.

- [ ] **Step 4: Generate route types and run route/storage tests**

Run: `npm run typecheck && npx vitest run 'app/routes/media.$.test.ts' src/server/r2.server.local.test.ts`

Expected: type generation succeeds and both suites pass.

- [ ] **Step 5: Commit the media route**

```bash
git add app/routes.ts 'app/routes/media.$.ts' 'app/routes/media.$.test.ts' src/server/r2.server.local.test.ts
git rm app/routes/api.local-storage.ts
git commit -m "feat: serve self-hosted media files"
```

### Task 4: Build the Self-Hosted Compose Topology

**Files:**

- Modify: `compose.yaml`
- Modify: `deploy/Caddyfile`
- Modify: `deploy/.env.production.example`
- Modify: `Dockerfile`
- Modify: `.gitignore`
- Modify: `.dockerignore`

- [ ] **Step 1: Express the expected Compose contract as a failing validation command**

Run the current configuration and inspect the missing services/volumes:

```bash
docker compose --env-file deploy/.env.production.example config --format json > deploy/compose.actual.json
node -e "
const c = require('./deploy/compose.actual.json');
if (!c.services.postgres) throw new Error('postgres service missing');
if (!c.volumes.postgres_data) throw new Error('postgres_data missing');
if (!c.volumes.media_data) throw new Error('media_data missing');
if (c.services.postgres.ports) throw new Error('postgres must not publish ports');
if (!c.services.web.ports[0].host_ip.includes('127.0.0.1')) throw new Error('web is not loopback-only');
"
```

Expected: FAIL with `postgres service missing`. Remove `deploy/compose.actual.json` after the assertion.

- [ ] **Step 2: Add PostgreSQL, persistent media, loopback web, and optional Caddy**

Use these service/volume contracts in `compose.yaml`:

```yaml
x-app: &app
  build: .
  image: ai-image-workshop:${IMAGE_TAG:-latest}
  env_file:
    - path: deploy/.env.production
      required: false
  restart: unless-stopped
  volumes:
    - media_data:/app/data/media
  networks: [app]

services:
  postgres:
    image: postgres:17-bookworm
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-ai_image_workshop}
      POSTGRES_USER: ${POSTGRES_USER:-ai_image_workshop}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 20
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks: [app]

  web:
    <<: *app
    command: npm run start:web
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_HOST_PORT:-18080}:3000"

  caddy:
    image: caddy:2.10-alpine
    profiles: [caddy]
    restart: unless-stopped
    environment:
      DOMAIN: ${DOMAIN}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - media_data:/srv/media:ro
      - caddy_data:/data
      - caddy_config:/config
```

Retain the existing web healthcheck and worker/scheduler dependencies. Add these named volumes:

```yaml
volumes:
  postgres_data:
  media_data:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: Configure direct Caddy media serving and runtime ownership**

Replace the route body in `deploy/Caddyfile` with:

```caddyfile
{$DOMAIN} {
  encode zstd gzip

  handle_path /media/* {
    root * /srv/media
    header Cache-Control "public, max-age=31536000, immutable"
    header X-Content-Type-Options "nosniff"
    file_server
  }

  handle {
    reverse_proxy web:3000
  }

  @assets path /assets/*
  header @assets Cache-Control "public, max-age=31536000, immutable"

  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
}
```

In the `Dockerfile` runtime stage, insert this before `USER node`:

```dockerfile
RUN mkdir -p /app/data/media && chown -R node:node /app/data
```

- [ ] **Step 4: Replace the production example with self-hosted defaults**

Set `deploy/.env.production.example` to non-secret validation values with these exact keys:

```dotenv
COMPOSE_PROJECT_NAME=ai-image-workshop
COMPOSE_PROFILES=caddy
IMAGE_TAG=latest
DOMAIN=example.com
WEB_BIND_ADDRESS=127.0.0.1
WEB_HOST_PORT=18080
POSTGRES_DB=ai_image_workshop
POSTGRES_USER=ai_image_workshop
POSTGRES_PASSWORD=example-only-change-this
DATABASE_DRIVER=pg
DATABASE_URL=postgresql://ai_image_workshop:example-only-change-this@postgres:5432/ai_image_workshop
DATABASE_URL_UNPOOLED=postgresql://ai_image_workshop:example-only-change-this@postgres:5432/ai_image_workshop
STORAGE_DRIVER=local
LOCAL_STORAGE_ROOT=/app/data/media
BETTER_AUTH_SECRET=example-only-change-this-to-32-random-bytes
BETTER_AUTH_URL=https://example.com
RELAY_API_KEY=example-only-change-this
RELAY_BASE_URL=https://api.tangguo.xin/v1
CUSTOM_KEY_JOB_ENCRYPTION_KEY=example-only-change-this-to-32-random-bytes
CUSTOM_KEY_MODES_ENABLED=false
WORKER_CONCURRENCY=1
TRUST_PROXY=true
```

Add `deploy/.env.production`, `deploy/backups/`, and `deploy/*.state` to `.gitignore`; add `deploy/backups`, `deploy/.env.production`, and `deploy/*.state` to `.dockerignore`.

- [ ] **Step 5: Validate the final Compose model**

Run:

```bash
npm run docker:validate
docker compose --env-file deploy/.env.production.example config --format json > deploy/compose.actual.json
node -e "
const c = require('./deploy/compose.actual.json');
if (!c.services.postgres || c.services.postgres.ports) process.exit(1);
if (!c.volumes.postgres_data || !c.volumes.media_data) process.exit(1);
if (c.services.web.ports[0].host_ip !== '127.0.0.1') process.exit(1);
if (!c.services.web.volumes.some(v => v.target === '/app/data/media')) process.exit(1);
if (!c.services.caddy.profiles.includes('caddy')) process.exit(1);
"
rm deploy/compose.actual.json
```

Expected: every command exits 0. The JSON contains no published PostgreSQL port and only a loopback web port.

- [ ] **Step 6: Commit the Compose topology**

```bash
git add compose.yaml deploy/Caddyfile deploy/.env.production.example Dockerfile .gitignore .dockerignore
git commit -m "feat: add self-hosted compose services"
```

### Task 5: Build and Test the Visible Three-Input Installer Library

**Files:**

- Create: `deploy/install-lib.sh`
- Create: `deploy/install-lib.test.sh`
- Modify: `package.json`

- [ ] **Step 1: Write failing shell contract tests**

Create `deploy/install-lib.test.sh` as a dependency-free Bash test runner. It must source `install-lib.sh`, count failures, and test these exact contracts:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/deploy/install-lib.sh"

failures=0
assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: %s\nexpected: %s\nactual:   %s\n' "$label" "$expected" "$actual" >&2
    failures=$((failures + 1))
  fi
}

assert_eq "'sk-test #1\$value'" "$(dotenv_quote 'sk-test #1$value')" "dotenv quoting"
validate_email 'admin@example.com' || failures=$((failures + 1))
validate_email 'not-an-email' && failures=$((failures + 1))
validate_password '123456' || failures=$((failures + 1))
validate_password '12345' && failures=$((failures + 1))
validate_password "$(printf 'x%.0s' {1..73})" && failures=$((failures + 1))

MODE_LABEL='existing-proxy'
input="$(printf 'sk-visible\ny\nadmin@example.com\npassword1\npassword1\ny\n')"
output="$(collect_install_inputs <<<"$input")"
[[ "$output" == *'You entered: sk-visible'* ]] || failures=$((failures + 1))
[[ "$output" == *'Administrator password:'* ]] || failures=$((failures + 1))
[[ "$output" == *'Repeat administrator password:'* ]] || failures=$((failures + 1))
[[ "$output" != *'password1'* ]] || failures=$((failures + 1))

if (( failures > 0 )); then exit 1; fi
printf 'install-lib tests passed\n'
```

Add separate cases for mismatched password input and rejected key confirmation; both must return non-zero without writing a file.

- [ ] **Step 2: Run the test and confirm the library is missing**

Run: `bash deploy/install-lib.test.sh`

Expected: FAIL because `deploy/install-lib.sh` does not exist.

- [ ] **Step 3: Implement validation, visible input, quoting, and port selection**

Create `deploy/install-lib.sh` with `set -euo pipefail`, no `set -x`, and these exported contracts:

```bash
#!/usr/bin/env bash
set -euo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; return 1; }

validate_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

validate_password() {
  local bytes
  bytes="$(LC_ALL=C printf '%s' "$1" | wc -c | tr -d ' ')"
  (( bytes >= 6 && bytes <= 72 ))
}

confirm_yes() {
  local answer
  printf '%s [y/N]: ' "$1"
  IFS= read -r answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

dotenv_quote() {
  local value="$1"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  printf "'%s'" "$value"
}

port_is_free() {
  local port="$1"
  ! ss -H -ltn "sport = :$port" | grep -q .
}

find_free_port() {
  local port
  for port in $(seq 18080 18180); do
    if port_is_free "$port"; then printf '%s\n' "$port"; return 0; fi
  done
  die 'No free loopback port in 18080-18180'
}

collect_install_inputs() {
  printf 'System relay API key: '
  IFS= read -r RELAY_API_KEY
  [[ -n "$RELAY_API_KEY" ]] || { die 'Relay API key cannot be empty'; return 1; }
  printf 'You entered: %s\n' "$RELAY_API_KEY"
  confirm_yes 'Use this relay API key?' || { die 'Relay API key was not confirmed'; return 1; }

  printf 'Administrator email: '
  IFS= read -r ADMIN_EMAIL
  validate_email "$ADMIN_EMAIL" || { die 'Administrator email is invalid'; return 1; }

  printf 'Administrator password: '
  IFS= read -r ADMIN_PASSWORD
  printf 'Repeat administrator password: '
  IFS= read -r ADMIN_PASSWORD_CONFIRM
  [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]] || {
    die 'Administrator passwords do not match'
    return 1
  }
  validate_password "$ADMIN_PASSWORD" || {
    die 'Administrator password must be 6-72 bytes'
    return 1
  }

  printf 'Deployment mode: %s\nAdministrator: %s\n' "$MODE_LABEL" "$ADMIN_EMAIL"
  confirm_yes 'Start deployment?' || { die 'Deployment was not confirmed'; return 1; }
}
```

The caller sets `MODE_LABEL` before calling `collect_install_inputs()`. Every input uses ordinary `IFS= read -r`; never pass `-s`, change terminal echo, write the values, or enable xtrace. The terminal therefore displays the password while the user types it, but the script does not print another copy.

- [ ] **Step 4: Add cryptographic generation and configuration rendering helpers**

Add:

```bash
random_hex() { openssl rand -hex "$1"; }
random_base64url() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }

load_deploy_env() {
  local source_file="$1" line name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die "Invalid deployment environment line"
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$name" in
      COMPOSE_PROJECT_NAME|COMPOSE_PROFILES|IMAGE_TAG|DOMAIN|WEB_BIND_ADDRESS|WEB_HOST_PORT|POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|DATABASE_DRIVER|DATABASE_URL|DATABASE_URL_UNPOOLED|STORAGE_DRIVER|LOCAL_STORAGE_ROOT|BETTER_AUTH_SECRET|BETTER_AUTH_URL|RELAY_API_KEY|RELAY_BASE_URL|CUSTOM_KEY_JOB_ENCRYPTION_KEY|CUSTOM_KEY_MODES_ENABLED|WORKER_CONCURRENCY|TRUST_PROXY) ;;
      *) die "Unknown deployment environment key: $name" ;;
    esac
    if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//\\\'/\'}"; value="${value//\\\\/\\}"; fi
    printf -v "$name" '%s' "$value"
    export "$name"
  done <"$source_file"
}

render_production_env() {
  local target="$1"
  umask 077
  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME"
    printf 'COMPOSE_PROFILES=%s\n' "$COMPOSE_PROFILES"
    printf 'IMAGE_TAG=latest\n'
    printf 'DOMAIN=%s\n' "$DOMAIN"
    printf 'WEB_BIND_ADDRESS=127.0.0.1\n'
    printf 'WEB_HOST_PORT=%s\n' "$WEB_HOST_PORT"
    printf 'POSTGRES_DB=ai_image_workshop\n'
    printf 'POSTGRES_USER=ai_image_workshop\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
    printf 'DATABASE_DRIVER=pg\n'
    printf 'DATABASE_URL=%s\n' "$(dotenv_quote "$DATABASE_URL")"
    printf 'DATABASE_URL_UNPOOLED=%s\n' "$(dotenv_quote "$DATABASE_URL")"
    printf 'STORAGE_DRIVER=local\n'
    printf 'LOCAL_STORAGE_ROOT=/app/data/media\n'
    printf 'BETTER_AUTH_SECRET=%s\n' "$BETTER_AUTH_SECRET"
    printf 'BETTER_AUTH_URL=%s\n' "$(dotenv_quote "$PUBLIC_URL")"
    printf 'RELAY_API_KEY=%s\n' "$(dotenv_quote "$RELAY_API_KEY")"
    printf 'RELAY_BASE_URL=https://api.tangguo.xin/v1\n'
    printf 'CUSTOM_KEY_JOB_ENCRYPTION_KEY=%s\n' "$CUSTOM_KEY_JOB_ENCRYPTION_KEY"
    printf 'CUSTOM_KEY_MODES_ENABLED=false\n'
    printf 'WORKER_CONCURRENCY=1\n'
    printf 'TRUST_PROXY=true\n'
  } >"$target"
  chmod 600 "$target"
}
```

The caller must set a URL-safe 32-byte hex `POSTGRES_PASSWORD`, 32-byte base64url auth/encryption values, deployment-mode values, and `DATABASE_URL` before rendering.

- [ ] **Step 5: Run shell tests and register the command**

Add to `package.json`:

```json
"test:deploy": "bash deploy/install-lib.test.sh && bash deploy/install.test.sh && bash deploy/backup-restore.test.sh",
"test:deploy:smoke": "bash deploy/ci-smoke.sh"
```

Run: `bash deploy/install-lib.test.sh`

Expected: `install-lib tests passed` and exit 0.

- [ ] **Step 6: Commit the installer library**

```bash
git add deploy/install-lib.sh deploy/install-lib.test.sh package.json package-lock.json
git commit -m "feat: add deployment input helpers"
```

### Task 6: Implement Initial Install and Resume Orchestration

**Files:**

- Create: `deploy/install.sh`
- Create: `deploy/install.test.sh`
- Modify: `deploy/install-lib.sh`

- [ ] **Step 1: Write fake-command tests for operation ordering**

Create `deploy/install.test.sh`. Build temporary fake `docker`, `ss`, and `curl` executables in a temporary `PATH`; each executable appends its arguments to `commands.log`, and Docker returns success for `info`, `compose version`, builds, migrations, seed, and health. Copy `install.sh`, `install-lib.sh`, `compose.yaml`, and `deploy/Caddyfile` into the temporary project before each case.

The first case must run:

```bash
printf 'relay-key\ny\nadmin@example.com\npassword1\npassword1\ny\n' |
  PATH="$FAKE_BIN:$PATH" bash "$PROJECT/deploy/install.sh" \
    --existing-proxy --public-url https://images.example --port 18081
```

Assert `commands.log` orders these operations:

```text
docker info
docker compose version
docker compose --env-file deploy/.env.production up -d postgres
docker compose --env-file deploy/.env.production build web
docker compose --env-file deploy/.env.production run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
docker compose --env-file deploy/.env.production run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD web node --import tsx scripts/seed-admin.ts
docker compose --env-file deploy/.env.production up -d web worker scheduler
```

Assert the generated environment file has mode `600`, contains the relay key, and does not contain `password1` or either `SEED_ADMIN_*` name. Add cases proving: no mode exits before prompts; occupied 80/443 rejects `--domain`; existing state rejects a fresh install; `--resume` reuses the existing environment without asking for or rotating secrets.

- [ ] **Step 2: Run the orchestration test and confirm the entry point is missing**

Run: `bash deploy/install.test.sh`

Expected: FAIL because `deploy/install.sh` does not exist.

- [ ] **Step 3: Implement CLI parsing and preflight before any secret prompt**

Create `deploy/install.sh` with `set -euo pipefail`, `umask 077`, and no xtrace. Support these accepted invocations:

```text
sudo bash deploy/install.sh --domain images.example.com
sudo bash deploy/install.sh --existing-proxy --public-url https://images.example.com
sudo bash deploy/install.sh --existing-proxy --public-url https://images.example.com --port 18081
sudo bash deploy/install.sh --resume
```

Parse only `--domain`, `--existing-proxy`, `--public-url`, `--port`, and `--resume`; reject unknown or contradictory options. Before `collect_install_inputs`, check: effective UID is root unless `INSTALL_ALLOW_NON_ROOT=1` is set by tests, `/etc/os-release` identifies Debian, commands `docker`, `openssl`, `ss`, `curl`, and `seq` exist, `docker info` succeeds, `docker compose version` succeeds, at least 10 GiB is free at the project path, and mode-specific ports are free. Never stop or reconfigure an existing container.

Set mode values exactly as follows:

```bash
if [[ "$MODE" == "domain" ]]; then
  DOMAIN="$DOMAIN_ARGUMENT"
  PUBLIC_URL="https://$DOMAIN_ARGUMENT"
  COMPOSE_PROFILES="caddy"
  port_is_free 80 && port_is_free 443 || die 'Ports 80 and 443 are required for bundled Caddy'
else
  DOMAIN="localhost"
  PUBLIC_URL="$PUBLIC_URL_ARGUMENT"
  COMPOSE_PROFILES=""
fi
WEB_HOST_PORT="${PORT_ARGUMENT:-$(find_free_port)}"
COMPOSE_PROJECT_NAME="ai-image-workshop"
```

Require `PUBLIC_URL` to start with `https://`, except that tests may use `http://127.0.0.1` when `INSTALL_ALLOW_HTTP=1`.

- [ ] **Step 4: Implement fresh-state protection and secret generation**

Treat any of these as existing state: `deploy/.env.production`, Docker volume `ai-image-workshop_postgres_data`, or Docker volume `ai-image-workshop_media_data`. A normal install must fail before changing state. `--resume` requires the existing environment and never generates secrets or prompts again.

For a fresh install, call `collect_install_inputs`, then generate and render:

```bash
POSTGRES_PASSWORD="$(random_hex 32)"
BETTER_AUTH_SECRET="$(random_base64url 32)"
CUSTOM_KEY_JOB_ENCRYPTION_KEY="$(random_base64url 32)"
DATABASE_URL="postgresql://ai_image_workshop:${POSTGRES_PASSWORD}@postgres:5432/ai_image_workshop"
render_production_env "$PROJECT_ROOT/deploy/.env.production"
```

After the environment file is safely written, install an `EXIT` trap that unsets `RELAY_API_KEY`, `ADMIN_PASSWORD`, and `ADMIN_PASSWORD_CONFIRM`. Do not print generated internal secrets.

- [ ] **Step 5: Implement migration, transient admin bootstrap, startup, and health checks**

Use one wrapper so every Compose call receives the same file:

```bash
cd "$PROJECT_ROOT"
compose() {
  docker compose --env-file deploy/.env.production "$@"
}
```

Run this order for initial install and resume:

```bash
compose up -d postgres
compose build web
compose run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  compose run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
  web node --import tsx scripts/seed-admin.ts
unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
compose up -d web worker scheduler
if [[ "$COMPOSE_PROFILES" == "caddy" ]]; then compose --profile caddy up -d caddy; fi
```

Poll PostgreSQL health for at most 120 seconds and the loopback `/healthz` endpoint for at most 180 seconds. Require HTTP 204. Verify both admin roles with a parameterized `psql` query run inside PostgreSQL; never print the password. On failure, print `docker compose ps`, the last 100 log lines for the failed service, and the exact `--resume` command.

Use `psql --set=admin_email="$ADMIN_EMAIL"` and `WHERE email=:'admin_email'` for each role lookup. For `--resume`, call `load_deploy_env` rather than `source` on the existing environment. Resume migrations and service startup. Skip administrator seed unless `deploy/install.state` says it was not completed; if needed, prompt only for the administrator email/password again and never rotate internal secrets.

- [ ] **Step 6: Persist resumable stage state and run installer contract tests**

Record completed stages atomically in `deploy/install.state` using a temporary file plus `mv` so `--resume` can continue after interruption. Never delete old volumes or call `docker compose down -v`.

Run: `bash deploy/install.test.sh`

Expected: the script prints `install orchestration tests passed`; no test log or generated environment contains the visible administrator password.

- [ ] **Step 7: Commit the installer**

```bash
git add deploy/install.sh deploy/install.test.sh deploy/install-lib.sh
git commit -m "feat: add one-command server installer"
```

### Task 7: Add Guarded Backup and Restore

**Files:**

- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Create: `deploy/backup-restore.test.sh`
- Modify: `deploy/install.sh`
- Modify: `deploy/install.test.sh`

- [ ] **Step 1: Write failing backup/restore contract tests**

Create `deploy/backup-restore.test.sh` with a temporary fake Docker binary and fixture `deploy/.env.production`. Assert:

1. `backup.sh` creates a mode-700 timestamp directory.
2. It invokes `pg_dump --format=custom`, archives `ai-image-workshop_media_data` read-only, writes `SHA256SUMS`, and retains only seven timestamp directories.
3. `restore.sh` refuses while any application service is running.
4. `restore.sh` refuses a non-empty media volume.
5. The exact visible confirmation `RESTORE ai-image-workshop` is required.
6. A valid restore verifies checksums before starting PostgreSQL or writing a volume.

The success fixture must contain `database.dump`, `media.tar.gz`, `manifest.env`, and a valid `SHA256SUMS` generated by `sha256sum`.

- [ ] **Step 2: Run the contract test and confirm both scripts are missing**

Run: `bash deploy/backup-restore.test.sh`

Expected: FAIL because `deploy/backup.sh` and `deploy/restore.sh` do not exist.

- [ ] **Step 3: Implement consistent local backups**

Create `deploy/backup.sh` with `umask 077`, source only function definitions from `install-lib.sh`, call `load_deploy_env` for `deploy/.env.production`, and use the stable Compose project name from that file. Create `deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)` with mode 700. Record which application services are running, stop only those services to prevent database/media writes during the backup, and install an `EXIT` trap that restarts only them:

```bash
mapfile -t RUNNING_APP_SERVICES < <(
  compose ps --status running --services web worker scheduler | sort -u
)
restart_services() {
  if (( ${#RUNNING_APP_SERVICES[@]} > 0 )); then
    compose start "${RUNNING_APP_SERVICES[@]}"
  fi
}
trap restart_services EXIT
if (( ${#RUNNING_APP_SERVICES[@]} > 0 )); then
  compose stop "${RUNNING_APP_SERVICES[@]}"
fi
```

Then execute:

```bash
compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom >"$BACKUP_DIR/database.dump"

docker run --rm \
  --volume "${COMPOSE_PROJECT_NAME}_media_data:/source:ro" \
  --volume "$BACKUP_DIR:/backup" \
  alpine:3.22 tar -C /source -czf /backup/media.tar.gz .
```

Write `manifest.env` containing UTC timestamp, Compose project name, image tag, and `git rev-parse HEAD` when available. Run `(cd "$BACKUP_DIR" && sha256sum database.dump media.tar.gz manifest.env > SHA256SUMS)`. Sort backup directories newest first and remove only entries after the seventh; validate every deletion target resolves below `deploy/backups` before `rm -rf`.

- [ ] **Step 4: Implement an empty-target, stopped-stack restore**

Create `deploy/restore.sh BACKUP_DIRECTORY`. It must resolve the backup path, require it to be below `deploy/backups`, verify all four files, run `sha256sum --check SHA256SUMS`, and require `compose ps --status running -q` to return empty. Require the user to type `RESTORE ai-image-workshop` visibly.

Check both PostgreSQL and media volume emptiness before starting a service. Run this command once with `media_data` and once with `postgres_data`:

```bash
docker run --rm --volume "${COMPOSE_PROJECT_NAME}_${VOLUME_NAME}:/target" alpine:3.22 \
  sh -c 'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)"'
```

Then restore in this order:

```bash
docker run --rm \
  --volume "${COMPOSE_PROJECT_NAME}_media_data:/target" \
  --volume "$BACKUP_DIR:/backup:ro" \
  alpine:3.22 tar -C /target -xzf /backup/media.tar.gz
docker run --rm --volume "${COMPOSE_PROJECT_NAME}_media_data:/target" \
  alpine:3.22 chown -R 1000:1000 /target
compose up -d postgres
compose exec -T postgres pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean --if-exists --no-owner <"$BACKUP_DIR/database.dump"
compose run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
compose up -d web worker scheduler
```

If Caddy profile is configured, start it afterward. Poll `/healthz` for 204 and print the restored timestamp. Never restore `deploy/.env.production` from the archive.

- [ ] **Step 5: Add the guarded upgrade path after backup exists**

Extend `deploy/install.sh` to accept `--upgrade` only by itself. Require existing configuration, run `deploy/backup.sh`, load the existing environment without sourcing it, and execute:

```bash
compose build web
compose run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
compose up -d --remove-orphans web worker scheduler
if [[ "$COMPOSE_PROFILES" == "caddy" ]]; then compose --profile caddy up -d caddy; fi
```

Run the same health checks as a fresh install. Extend `deploy/install.test.sh` to assert that backup precedes build, migration, and restart, and that the path never invokes `docker compose down -v`.

- [ ] **Step 6: Run installer and backup/restore contract tests**

Run: `bash deploy/install.test.sh && bash deploy/backup-restore.test.sh`

Expected: `backup/restore tests passed` and exit 0.

- [ ] **Step 7: Commit backup, restore, and upgrade**

```bash
git add deploy/backup.sh deploy/restore.sh deploy/backup-restore.test.sh deploy/install.sh deploy/install.test.sh
git commit -m "feat: add local backup and restore tooling"
```

### Task 8: Add a Real Empty-Stack CI Smoke

**Files:**

- Create: `deploy/ci-smoke.sh`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the smoke script around the production Compose file**

Create `deploy/ci-smoke.sh` with an isolated project name `ai-image-workshop-ci-${GITHUB_RUN_ID:-local}-$$`, a temporary environment file, and an `EXIT` trap that runs `docker compose down --volumes --remove-orphans` and deletes the environment. Before starting Compose, launch a tiny background Node HTTP server bound to host port 3000 and add its PID to the cleanup trap; this proves the application never needs that occupied host port. Generate the web's free loopback port with Node's `net.createServer().listen(0)` API. Set deterministic non-production admin credentials and random internal secrets; never print them.

The script must execute:

```bash
compose up -d postgres
compose run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
SEED_ADMIN_EMAIL=admin@example.test SEED_ADMIN_PASSWORD=ci-password-123 \
  compose run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
  web node --import tsx scripts/seed-admin.ts
compose up -d web worker scheduler
```

Then assert all of these:

```bash
curl --fail --silent --output /dev/null "http://127.0.0.1:${WEB_HOST_PORT}/healthz"
compose exec -T postgres psql -U ai_image_workshop -d ai_image_workshop -Atc \
  "SELECT role FROM users WHERE email='admin@example.test'" | grep -qx admin
compose exec -T postgres psql -U ai_image_workshop -d ai_image_workshop -Atc \
  "SELECT role FROM \"user\" WHERE email='admin@example.test'" | grep -qx admin
compose exec -T web node --import tsx -e \
  "const m=await import('./src/server/local-storage.server.ts'); await m.writeLocalStorageObject('ci/persist.png',new Uint8Array([1,2,3]));"
curl --fail --silent "http://127.0.0.1:${WEB_HOST_PORT}/media/ci/persist.png" | cmp - <(printf '\001\002\003')
compose up -d --force-recreate --wait --wait-timeout 180 web worker scheduler
curl --fail --silent "http://127.0.0.1:${WEB_HOST_PORT}/media/ci/persist.png" | cmp - <(printf '\001\002\003')
```

Also assert `compose ps --status running --services` includes exactly `postgres`, `web`, `worker`, and `scheduler` when Caddy is disabled. The smoke does not call the external relay; real relay generation remains a deployment acceptance check because CI must not require a production API key.

- [ ] **Step 2: Run the smoke against a locally built image**

Run:

```bash
docker build --tag ai-image-workshop:ci .
IMAGE_TAG=ci bash deploy/ci-smoke.sh
```

Expected: the script prints `self-hosted compose smoke passed`, all four services are healthy/running, and its cleanup trap removes the isolated containers and volumes.

- [ ] **Step 3: Add shell and real-stack checks to GitHub Actions**

Insert after `Validate Docker Compose` in `.github/workflows/ci.yml`:

```yaml
      - name: Deployment script contract tests
        run: npm run test:deploy
```

Insert after the Docker runtime dependency validation:

```yaml
      - name: Empty self-hosted stack smoke
        env:
          IMAGE_TAG: ci
        run: npm run test:deploy:smoke
```

The existing Docker build step must remain before the smoke and keep the tag `ai-image-workshop:ci`.

- [ ] **Step 4: Commit CI coverage**

```bash
git add deploy/ci-smoke.sh .github/workflows/ci.yml
git commit -m "test: smoke self-hosted docker deployment"
```

### Task 9: Update the Short Operational Documentation

**Files:**

- Modify: `docs/dev/deploy.md`
- Modify: `docs/dev/01-architecture.md`
- Modify: `docs/dev/02-database.md`
- Modify: `docs/dev/06-storage.md`
- Modify: `docs/dev/10-ops-test.md`
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: Replace deployment instructions with the three supported commands**

Keep `docs/dev/deploy.md` under 180 lines. Put these commands first:

```bash
# Bundled Caddy owns 80/443
sudo bash deploy/install.sh --domain images.example.com

# Existing reverse proxy forwards to the printed 127.0.0.1 port
sudo bash deploy/install.sh --existing-proxy --public-url https://images.example.com

# Resume an interrupted install without rotating generated secrets
sudo bash deploy/install.sh --resume
```

State that the terminal asks only for relay key, administrator email, and visible administrator password; ordinary terminal echo intentionally leaves typed secrets in scrollback; the login is `/admin/login`; host ports 3000/5432 are not used; and the first deployment starts with no migrated Neon/Supabase data. Add exact daily operations:

```bash
sudo bash deploy/backup.sh
sudo bash deploy/install.sh --upgrade
sudo bash deploy/restore.sh deploy/backups/20260712T120000Z
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=100 web worker scheduler postgres
```

Add a five-line existing-proxy example whose upstream is the installer-printed `http://127.0.0.1:18080`; do not duplicate a full Nginx/Caddy manual.

- [ ] **Step 2: Align architecture, database, storage, and ops truth sources**

In `docs/dev/01-architecture.md`, show production ownership as `Caddy/existing proxy -> web -> PostgreSQL + media_data`, with worker/scheduler sharing both data services. In `docs/dev/02-database.md`, state `DATABASE_DRIVER=pg` selects standard `pg` pools while managed Neon remains an optional driver. In `docs/dev/06-storage.md`, state `STORAGE_DRIVER=local`, `/app/data/media`, immutable relative `/media/<key>` URLs, and the retained S3-compatible alternative. In `docs/dev/10-ops-test.md`, list the CI smoke, real relay generation check, backup restore drill, and container-recreate persistence check.

- [ ] **Step 3: Update progress as a compact status table**

In `docs/PROGRESS.md`, mark these rows complete and remove superseded open deployment bullets instead of appending a diary:

```markdown
| Self-hosted PostgreSQL | Complete | Private Compose service and persistent volume |
| Self-hosted media | Complete | Shared local volume and `/media/*` route |
| One-command Debian install | Complete | Three visible inputs; generated internal secrets |
| Backup and restore | Complete | Checked local DB/media archives; seven-copy retention |
| Deployment CI | Complete | Script contracts and empty-stack persistence smoke |
```

Leave multi-host HA and off-site backup explicitly out of scope in one sentence.

- [ ] **Step 4: Check documentation length and stale provider claims**

Run:

```bash
wc -l docs/dev/deploy.md docs/PROGRESS.md
rg -n "Netlify deploy|Netlify scheduled|production requires Neon|production requires Supabase" docs/dev docs/PROGRESS.md
```

Expected: `docs/dev/deploy.md` is at most 180 lines, `docs/PROGRESS.md` is at most 220 lines, and the search finds no active claim that self-hosted production requires Netlify, Neon, or Supabase. Historical decision records may retain those names when clearly labeled historical.

- [ ] **Step 5: Commit documentation state**

```bash
git add docs/dev/deploy.md docs/dev/01-architecture.md docs/dev/02-database.md docs/dev/06-storage.md docs/dev/10-ops-test.md docs/PROGRESS.md
git commit -m "docs: document self-hosted server operations"
```

### Task 10: Run Full Verification and Deployment Acceptance

**Files:**

- Modify only files required to fix failures introduced by Tasks 1-9; do not perform unrelated refactors.

- [ ] **Step 1: Run static, unit, build, and secret checks**

Run:

```bash
npm ci
npm run typecheck
npm run test:run
npm run build
npm run assert-no-secrets
npm run docker:validate
npm run test:deploy
```

Expected: every command exits 0; Vitest reports no failed suites; the secret scan reports no server secret or schema leakage.

- [ ] **Step 2: Build and inspect the production image**

Run:

```bash
docker build --tag ai-image-workshop:acceptance .
docker run --rm ai-image-workshop:acceptance node -e "
const fs=require('node:fs');
for (const p of ['/app/build/server/index.js','/app/scripts/seed-admin.ts','/app/data/media']) {
  if (!fs.existsSync(p)) throw new Error('missing '+p);
}
"
```

Expected: image build succeeds and the filesystem assertion exits 0.

- [ ] **Step 3: Run the real empty-stack and persistence smoke**

Run: `IMAGE_TAG=acceptance npm run test:deploy:smoke`

Expected: `self-hosted compose smoke passed`; its cleanup trap leaves no `ai-image-workshop-ci-*` containers or volumes.

- [ ] **Step 4: Run the money transaction suite against disposable PostgreSQL**

Start a dedicated disposable PostgreSQL container, create the guarded test environment with the repository helper, apply test migrations, run the suite, and clean up:

```bash
docker run --detach --name ai-image-workshop-money-test \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_DB=iamge_test \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:17-bookworm
until docker exec ai-image-workshop-money-test pg_isready -U postgres -d iamge_test; do sleep 1; done
node --import tsx scripts/init-local-test-env.ts
npm run db:test:migrate
npm run test:money
rm -f .env.test
docker rm --force ai-image-workshop-money-test
```

The helper must produce `.env.test` with `MONEY_TEST_ALLOW_MUTATION=I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE`, both URLs pointing only to `127.0.0.1:55432/iamge_test`, and `DISPOSABLE_TEST_DB_DRIVER=pg`; inspect those non-secret target fields before migration. Expected: every money/locking test passes, proving the new standard `pg` branch retains `FOR UPDATE`, rollback, and concurrency semantics. Use an `EXIT` trap around these commands during execution so `.env.test` and only `ai-image-workshop-money-test` are removed after a failure.

- [ ] **Step 5: Perform one controlled server acceptance with the real relay key**

On a fresh Debian test server or disposable VM, run the installer in the chosen proxy mode while another process owns host port 3000. Confirm the visible sequence is relay key, key confirmation, email, password, repeat password, final confirmation. Then verify: register a normal user; log in at `/admin/login`; submit one system-key image generation; wait for the worker; reload the generated image from `/media/*`; invoke the image-cleanup job once and confirm a successful response; recreate web/worker/scheduler containers; reload the same image; run `backup.sh`; restore that backup into new empty project volumes; and confirm `/healthz` returns 204.

Expected: all acceptance actions succeed without Neon, Supabase, Netlify, host port 3000, or host port 5432. The server retains PostgreSQL and media data after application container recreation.

- [ ] **Step 6: Inspect the final diff and commit only verification fixes**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~9..HEAD
```

Expected: no whitespace errors, no generated environment/backups/state files tracked, and changes remain inside the planned deployment/runtime/docs boundary.

If verification required code fixes, commit them with:

```bash
git add -u
git commit -m "fix: close self-hosted deployment verification gaps"
```

If no fixes were needed, do not create an empty commit.
