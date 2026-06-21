# AI Image Workshop Development Guide

> **Note (2026-06-20):** A Composer-first redesign is planned — see [redesign-requirements.md](redesign-requirements.md). The async proxy / job pattern and response/redaction layers are reused by v2, but two things change beyond the UI: (1) the **API key moves to a server-side env var** — the proxy stops accepting `apiKey` from the client and injects a hard-coded key instead, and the frontend key UI/storage/validation is removed; (2) v2 **adds** a user account system (registration/login + database, login required) and **backend persistence** for conversations and images. The v1 two-column UI ("Visual Implementation Notes" below, components under `src/components`) is reworked.

## Stack

- Vite + React + TypeScript (single-page app)
- Vitest + React Testing Library + jsdom
- `lucide-react` for icons
- Netlify Functions + Netlify Blobs (serverless proxy + async job store)
- Plain CSS (`src/styles.css`)

## Architecture Overview

In production the browser **never calls the relay directly**. The app is split into
four layers, and the user's relay key only travels from the browser to the app's
own serverless proxy, which forwards it to the relay and redacts it from anything
returned to the browser:

1. **React UI** (`src/App.tsx`, `src/components/*`, `src/hooks/*`) — presentation
   and state.
2. **Client request layer** (`src/api/*`) — payload/URL building, response parsing,
   and the proxy transport the UI actually uses.
3. **Framework-agnostic server layer** (`src/server/*`) — the relay proxy plus the
   async job lifecycle. Shared by both the Netlify Functions and the local Vite dev
   middleware.
4. **Netlify Functions** (`netlify/functions/*`) — thin serverless adapters that
   wire the server layer to Netlify's request/response objects and to Netlify Blobs.

## Project Structure

```text
src/
  api/
    imageGeneration.ts        # payload/URL building, response parsing, direct relay adapter (test-only)
    imageGeneration.test.ts
    proxyGeneration.ts        # live transport: calls the Netlify function and polls job status
    proxyGeneration.test.ts
  components/
    ApiConfigModal.tsx
    GeneratorForm.tsx
    ResultPanel.tsx
  hooks/
    useApiConfig.ts
  lib/
    curl.ts                   # redacted curl preview (built + tested, not wired into the UI)
    curl.test.ts
    redaction.ts              # secret redaction for logs/previews/proxy bodies
    redaction.test.ts
    storage.ts                # localStorage access, model list, default config
    storage.test.ts
    validation.ts             # config + generation input validation
    validation.test.ts
  server/
    imageProxy.ts             # relays the request to the fixed relay, redacts the key
    imageProxy.test.ts
    asyncImageJob.ts          # generate/status handlers + runImageJob lifecycle
    asyncImageJob.test.ts
    jobStore.ts               # Netlify Blobs-backed JobsStore
  test/
    setup.ts
  App.tsx
  App.test.tsx
  main.tsx
  styles.css

netlify/
  functions/
    generate.ts               # POST: create job, trigger background worker, return 202 {jobId}
    generate-background.ts    # background worker: runImageJob -> relay -> store result
    generate-status.ts        # GET: poll job status
netlify.toml                  # build settings + redirects
```

## Responsibility Boundaries

- `src/api/imageGeneration.ts`
  - Builds Image API-compatible payloads (`buildImageGenerationPayload`) and endpoint
    URLs (`buildImageGenerationUrl`).
  - Parses permissive relay response shapes into displayable images
    (`parseImageGenerationResponse`): `data[].url`, `data[].image_url`,
    `data[].b64_json`, and `output[]` arrays of URL/base64 values.
  - Also exports a direct browser-to-relay adapter (`generateImage`). It is
    unit-tested but **no longer used by the UI**; it is kept as the single
    transport-swap boundary.

- `src/api/proxyGeneration.ts`
  - The transport the UI actually uses (`generateImageViaProxy`).
  - POSTs to `/.netlify/functions/generate`. If the reply contains a `jobId`, it polls
    `/.netlify/functions/generate-status` (2s interval, up to 450 attempts ≈ 15 min);
    if there is no `jobId`, it parses the body immediately (the synchronous dev path).
  - Maps proxy/relay failures to actionable, localized messages
    (404 missing function, 502 `upstream_error`, 504 gateway timeout).

- `src/server/imageProxy.ts`
  - `handleImageProxyRequest` validates the key, then relays
    `POST {fixed relay}/images/generations` with `Authorization: Bearer {apiKey}`,
    forces `n` to `1`, and **redacts the key from the returned body**.
  - Ignores any client-supplied Base URL and always relays to
    `DEFAULT_API_CONFIG.baseUrl`.

- `src/server/asyncImageJob.ts`
  - `createGenerateHandler` (create a `pending` job, fire the background trigger,
    return `202 {jobId}`), `createStatusHandler` (poll), and `runImageJob`
    (`pending` → `running` → `succeeded`/`failed`).

- `src/server/jobStore.ts`
  - Wraps `@netlify/blobs` (store name `image-generation-jobs`) as a `JobsStore`.

- `netlify/functions/*`
  - `generate.ts`, `generate-background.ts`, `generate-status.ts` adapt the server
    layer to Netlify. `generate.ts` fire-and-forgets a fetch to the background
    function using `process.env.URL` / `DEPLOY_PRIME_URL` for the site base URL.

- `src/lib/redaction.ts`
  - Redacts user-provided keys and common `sk-...` bearer tokens (to `sk-***`) before
    errors, raw JSON, or stored job bodies are rendered.

- `src/lib/validation.ts`
  - Validates API config and generation form inputs (prompt non-empty; quantity fixed
    to `1`; Base URL must start with `http(s)://`).

- `src/lib/storage.ts`
  - Default config, supported model list, and `localStorage` read/write. Always forces
    the fixed Base URL and persists the key only when the remember-key option is on.

- `src/hooks/useApiConfig.ts`
  - Reads and writes API config via `storage.ts` and exposes config state to the app.

- `src/components/*`
  - Pure UI components driven by props. No direct network calls inside presentational
    components.

## Runtime Topology

### Production (Netlify): async background job + polling

1. The UI calls `POST /.netlify/functions/generate` with `{ baseUrl, apiKey, request }`.
2. The handler stores a `pending` `JobRecord` in Netlify Blobs under a
   `crypto.randomUUID()` id, fire-and-forgets a `POST` to
   `/.netlify/functions/generate-background`, and returns `202 { jobId, status: "pending" }`.
3. The background function runs `runImageJob`: marks the job `running`, relays the
   request to the One-API relay via `handleImageProxyRequest`, then stores the job as
   `succeeded`/`failed` with the **redacted** response body.
4. The client polls `GET /.netlify/functions/generate-status?id={jobId}` every 2s until
   the job is terminal, then parses the stored body into images.

Why this shape: it keeps the per-request key off the browser→relay hop, and it avoids
the standard Netlify function timeout for slow image generation — Netlify *background*
functions may run up to ~15 minutes, which the 450×2s client poll window matches.

### Local development (Vite): synchronous proxy

- `npm run dev` serves only the SPA. The live client calls
  `/.netlify/functions/generate`, which plain Vite does not serve, so **use
  `netlify dev`** to exercise the full generate → background → status flow locally
  (it serves the functions and Blobs alongside Vite).
- `vite.config.ts` additionally registers an `imageProxyPlugin` middleware on
  `/api/generate` that calls the same `handleImageProxyRequest` **synchronously** (no
  job store, no polling) and returns the relay result inline. This mirrors the
  `netlify.toml` `/api/generate` rewrite and lets you exercise the relay proxy directly
  without the async job layer; the current UI does not call this route.

## API Contract

Serverless proxy entry — what the UI calls:

```http
POST /.netlify/functions/generate
Content-Type: application/json
```

```json
{
  "baseUrl": "https://api.tangguo.xin/v1",
  "apiKey": "user relay key",
  "request": {
    "model": "gpt-image-1-mini",
    "prompt": "用户输入的提示词",
    "size": "auto",
    "quality": "auto",
    "background": "auto",
    "moderation": "auto",
    "n": 1
  }
}
```

Response: `202 { "jobId": "...", "status": "pending" }`.

Status poll:

```http
GET /.netlify/functions/generate-status?id={jobId}
```

- In flight: `{ "status": "pending" | "running" }`
- Terminal: `{ "status": "succeeded" | "failed", "response": { "status": number, "headers": {…}, "body": "<relay JSON as text>" } }`

Upstream relay call — made server-side by the proxy. The client-supplied `baseUrl` is
ignored in favor of the fixed relay:

```http
POST https://api.tangguo.xin/v1/images/generations
Authorization: Bearer {apiKey}
Content-Type: application/json
```

`netlify.toml` also rewrites `/api/generate → /.netlify/functions/generate` and
SPA-routes `/* → /index.html`.

## Visual Implementation Notes

- Use a max-width centered page container close to the reference width.
- Use a header height around 72px.
- Use compact card padding around 24px.
- Use `#ffffff` cards, `#f7f7f8` page background, `#e6e6e8` borders, and black primary buttons.
- Cards should use an 8px or 10px radius; controls can use 10px for the reference look.
- The API modal overlay should blur and darken the page behind it.
- Do not add a marketing hero or decorative background.

## Test Strategy

- Unit tests:
  - Config validation, payload/URL building, response parsing.
  - Storage read/write fallback behavior.
  - Secret redaction (`redactText`, `redactSecrets`).
  - Proxy transport (`proxyGeneration`): job start + status polling, and failure-message
    mapping for 404 / 502 `upstream_error` / 504 (including stripping raw gateway HTML).
  - Server layer (`imageProxy`, `asyncImageJob`): relay forwarding + key redaction,
    method guards, and the job lifecycle (create → run → status).
- Component tests:
  - API modal save flow.
  - Missing config validation.
  - Missing prompt validation.
  - Success rendering with a mocked generation adapter.
  - Error rendering with a mocked generation adapter.
- Build verification:
  - `npm run test:run`
  - `npm run build`

## Development Rules

- Write tests before production code for behavior-bearing modules.
- Keep the request adapters (`src/api`) and the server layer (`src/server`) independent
  from React.
- Keep secrets out of previews, logs, and stored job records; redact the user key and
  `sk-...` tokens as `sk-***`.
- Store the API key persistently only when the user enables the remember-key option.
- Keep the relay Base URL fixed to `https://api.tangguo.xin/v1`; the server ignores any
  client-supplied Base URL, and the UI exposes no Base URL input.
- Surface relay 502 `upstream_error` and 504 timeouts as actionable messages instead of
  rendering raw gateway HTML. Messages should mention possible runtime platform,
  gateway/CDN, application timeout, or upstream-call log checks rather than assuming
  Nginx exists on the user's server.
- Do not implement image-to-image yet — it remains a placeholder tab that shows a
  "developing" toast.
