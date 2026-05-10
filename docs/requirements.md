# AI Image Workshop Requirements

## Product Goal

Build a pure frontend text-to-image website for `gpt-image-2`-style generation through a user-provided API relay. The first release must reproduce the visual structure in the supplied reference images: a quiet two-column tool page, a top-right API relay configuration button, and a centered configuration modal.

## Deployment Model

- The first release is a static frontend app.
- Users provide their relay `Base URL` and `API Key` in the browser.
- The app sends requests directly to the relay.
- The request layer must be isolated so a future backend proxy endpoint such as `/api/generate` can replace direct relay calls without rewriting UI code.

## Audience

The primary user is a creator or operator who already has an API relay account and wants a simple web UI for generating images. They need clear controls, visible request previews, and raw response output for debugging relay compatibility.

## In Scope

- Text-to-image only.
- Vite + React + TypeScript single-page application.
- Main layout modeled after the reference image.
- API configuration modal modeled after the second reference image.
- Persist `Base URL` to `localStorage`. Persist `API Key` only when the user explicitly chooses to remember it on this device.
- Validate required fields before generation:
  - API key is present.
  - Base URL is present and has an HTTP or HTTPS scheme.
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
- Show a return-format UI control for relay compatibility. The first release defaults this to automatic behavior and does not send unsupported format parameters unless the adapter is explicitly extended later.
- Default to `gpt-image-1-mini` to reduce local relay timeout risk. Keep `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-2` selectable for relay-specific compatibility.
- Generate and display a redacted CURL preview.
- Display empty, loading, success, and error states.
- Parse common relay response shapes:
  - `data[].url`
  - `data[].b64_json`
  - `output` arrays containing image URLs or base64 images.
- Show redacted raw JSON response in a collapsible section.
- Allow copying CURL preview.
- Allow downloading generated images when the output can be resolved to a URL or data URL.
- Keep a disabled image-to-image tab as a visual placeholder only.

## Out of Scope

- Image-to-image generation.
- User account registration.
- Server-side key storage.
- Billing, quota, or account balance display.
- Backend proxy implementation.
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
  - Dashed quota callout with button text `前往「智岛 API 官网」注册获取`
  - Base URL field.
  - API Key password field.
  - Save button.
- The generation button should be disabled while generating.
- Error messages should be plain and actionable.

## Security Requirements

- The API key must never appear in the CURL preview or raw request preview.
- The key may be saved in `localStorage` only after the user clicks save and enables the remember-key option. Redaction applies to previews, logs, and visible debug output.
- The UI must mention that browser-side direct calls use the user's relay key locally.
- Logs and visible debug panels must redact secrets.
- The request layer must not hard-code a private key.

## Compatibility Requirements

- The request layer must normalize Base URLs with or without a trailing slash.
- The request layer must expose endpoint path construction as a single helper so the default `/images/generations` path can be changed later without touching UI components.
- The first release should assume OpenAI Image API compatibility but keep response parsing permissive.
- CORS failures should be surfaced as a likely browser-to-relay configuration issue.
- Relay gateway timeouts such as HTTP 504 should be surfaced as a relay/upstream timeout, not as raw gateway HTML or a server-specific Nginx assumption.

## Acceptance Criteria

- A user can open the app, configure Base URL and API key, enter a prompt, and send a text-to-image request.
- The app displays generated images when the relay returns a supported image response.
- The app displays meaningful errors for missing config, missing prompt, invalid Base URL, HTTP failures, malformed JSON, and CORS-like network failures.
- CURL preview updates when parameters change and redacts the API key.
- Redacted raw response JSON is viewable after a request.
- The API config modal visually matches the provided reference closely enough for layout, spacing, and hierarchy.
- Unit tests cover request building, config validation, response parsing, malformed JSON handling, and preview redaction behavior.
- UI tests cover API modal save behavior, form validation, success/error rendering with mocked network calls, and generated-image download controls.
