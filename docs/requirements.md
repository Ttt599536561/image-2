# AI Image Workshop Requirements

> **Scope note (2026-06-20):** This document describes the **v1 two-column tool** that is currently implemented. The product is moving to a **Composer-first (conversational) redesign** — see [redesign-requirements.md](redesign-requirements.md) for the v2 product requirements that drive upcoming development. Where this v1 document and the redesign differ, the redesign governs new work. In particular, v2 **changes the key model**: the relay URL and API key are hard-coded **server-side** (Netlify env var) and the whole user-key UI below (config modal, remember-key, localStorage key, `validateApiConfig`) is **removed**; v2 also adds user registration/login (with a database, login required) and backend conversation/image history. Requirements that still hold (fixed relay, default `gpt-image-1-mini`, quantity fixed to 1, permissive response parsing, secret redaction, async serverless proxy) carry over to v2.

## Product Goal

Build a pure frontend text-to-image website for `gpt-image-2`-style generation through a user-provided API relay. The first release must reproduce the visual structure in the supplied reference images: a quiet two-column tool page, a top-right API relay configuration button, and a centered configuration modal.

## Deployment Model

- The app ships as a Vite-built SPA plus Netlify serverless functions (`dist/` + `netlify/functions`).
- Users provide only their API key in the browser. The key is sent to the app's own serverless proxy per request and forwarded to the relay; it is never stored server-side and is redacted from anything returned to the browser.
- All relay traffic goes to the fixed relay `https://api.tangguo.xin/v1` through the serverless proxy. (This was originally planned as direct browser-to-relay calls; the proxy was added to keep the key off the browser→relay hop and to avoid function timeouts via an async background job + status polling.)
- The request layer is isolated behind a single transport boundary (`src/api`), so the transport can change (direct vs proxy vs async job) without rewriting UI code. The original `/api/generate` entry is preserved as a synchronous proxy route (Vite dev middleware and `netlify.toml` rewrite).

## Audience

The primary user is a creator who already has an API key for the fixed One-API relay and wants a simple web UI for generating images.

## In Scope

- Text-to-image only.
- Vite + React + TypeScript single-page application.
- Main layout modeled after the reference image.
- API configuration modal modeled after the second reference image.
- Use the fixed relay Base URL `https://api.tangguo.xin/v1`. Persist `API Key` only when the user explicitly chooses to remember it on this device.
- Validate required fields before generation:
  - API key is present.
  - Prompt is present after trimming whitespace.
- Default direct endpoint mode:
  - `POST {baseUrl}/images/generations`
  - `Authorization: Bearer {apiKey}`
  - `Content-Type: application/json`
- Build request payload from UI parameters:
  - `model`
  - `prompt`
  - `size`
  - `quality`
  - `background`
  - `moderation`
  - `n`
- Hide the return-format and quantity controls. Generation quantity is always fixed to `1`.
- Default to `gpt-image-1-mini` to reduce local relay timeout risk. Keep `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-2` selectable for relay-specific compatibility.
- Display empty, loading, success, and error states.
- Parse common relay response shapes:
  - `data[].url`
  - `data[].b64_json`
  - `output` arrays containing image URLs or base64 images.
- Show redacted raw JSON response in a collapsible section.
- Allow downloading generated images when the output can be resolved to a URL or data URL.
- Keep an image-to-image tab as a visual placeholder; clicking it shows a "developing" toast.

## Out of Scope

- Image-to-image generation.
- User account registration.
- Server-side key *storage* (the serverless proxy forwards the key per request but never persists it).
- Billing, quota, or account balance display.
- OpenAI official account management.
- Persistent generation history beyond current page state.

## UX Requirements

- The first screen must be the usable generator, not a landing page.
- The interface should use a light neutral background, white cards, thin borders, compact controls, and black primary actions.
- The header should display:
  - `AI 图像工坊`
  - `全网可用 · GPT Image 2 文生图`
  - `中转站 API 配置` button with an icon.
- The main area should have:
  - Left parameter card.
  - Right result card.
  - A responsive single-column layout on narrow screens.
- The modal should include:
  - Title `自定义 API 中转站配置`
  - Close button.
  - Short explanatory copy.
  - Dashed quota callout with link text `前往One-API官网注册获取`, opening `https://api.tangguo.xin/`
  - Fixed relay display for `https://api.tangguo.xin/v1`.
  - API Key password field.
  - Save button.
- The generation button should be disabled while generating.
- Error messages should be plain and actionable.

## Security Requirements

- The API key must never appear in visible debug output.
- The key may be saved in `localStorage` only after the user clicks save and enables the remember-key option. Redaction applies to previews, logs, and visible debug output.
- The UI must communicate that the user's relay key is used only to call the configured relay (via the app's serverless proxy) and is not stored server-side.
- Logs and visible debug panels must redact secrets.
- The request layer must not hard-code a private key.

## Compatibility Requirements

- The request layer must use the fixed relay Base URL and ignore user-provided or stale stored Base URLs.
- The request layer must expose endpoint path construction as a single helper so the default `/images/generations` path can be changed later without touching UI components.
- The first release should assume OpenAI Image API compatibility but keep response parsing permissive.
- CORS failures should be surfaced as a likely browser-to-relay configuration issue.
- Relay gateway timeouts such as HTTP 504 should be surfaced as a relay/upstream timeout, not as raw gateway HTML or a server-specific Nginx assumption.

## Acceptance Criteria

- A user can open the app, enter an API key, enter a prompt, and send a text-to-image request through the fixed relay.
- The app displays generated images when the relay returns a supported image response.
- The app displays meaningful errors for missing config, missing prompt, invalid Base URL, HTTP failures, malformed JSON, and CORS-like network failures.
- Redacted raw response JSON is viewable after a request.
- The API config modal visually matches the provided reference closely enough for layout, spacing, and hierarchy.
- Unit tests cover request building, config validation, response parsing, malformed JSON handling, and preview redaction behavior.
- UI tests cover API modal save behavior, form validation, success/error rendering with mocked network calls, and generated-image download controls.
