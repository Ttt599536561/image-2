# AI Image Workshop Development Guide

## Stack

- Vite
- React
- TypeScript
- Vitest
- React Testing Library
- `lucide-react` for icons

## Project Structure

```text
src/
  api/
    imageGeneration.ts
  components/
    ApiConfigModal.tsx
    GeneratorForm.tsx
    ResultPanel.tsx
  hooks/
    useApiConfig.ts
  lib/
    curl.ts
    errors.ts
    storage.ts
    validation.ts
  test/
    setup.ts
  App.tsx
  main.tsx
  styles.css
```

## Responsibility Boundaries

- `src/api/imageGeneration.ts`
  - Builds Image API-compatible payloads.
  - Sends direct browser requests to the configured relay.
  - Parses supported response shapes into displayable image objects.
  - Provides a single adapter boundary for a future backend proxy.

- `src/lib/redaction.ts`
  - Redacts user-provided keys and common bearer-token strings before errors or raw JSON content are rendered.

- `src/lib/validation.ts`
  - Validates API config and generation form inputs.

- `src/hooks/useApiConfig.ts`
  - Reads and writes API config in `localStorage`.
  - Exposes config state to the app.

- `src/components/*`
  - Pure UI components driven by props.
  - No direct network calls inside presentational components.

## API Contract

Default relay request:

```http
POST https://api.tangguo.xin/v1/images/generations
Authorization: Bearer {apiKey}
Content-Type: application/json
```

Request body:

```json
{
  "model": "gpt-image-1-mini",
  "prompt": "用户输入的提示词",
  "size": "1024x1024",
  "quality": "auto",
  "background": "auto",
  "moderation": "auto",
  "n": 1
}
```

The local same-origin Vite proxy forwards only to the fixed One-API relay. It ignores stale or user-provided Base URLs.

```http
POST /api/generate
Content-Type: application/json
```

```json
{
  "baseUrl": "https://api.tangguo.xin/v1",
  "apiKey": "user relay key",
  "request": {
    "model": "gpt-image-2",
    "prompt": "用户输入的提示词",
    "size": "1024x1024",
    "quality": "auto",
    "background": "auto",
    "moderation": "auto",
    "n": 1
  }
}
```

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
  - Config validation.
  - Payload creation.
  - Response parsing.
  - Storage read/write fallback behavior.
- Component tests:
  - API modal save flow.
  - Missing config validation.
  - Missing prompt validation.
  - Success rendering with mocked generation adapter.
  - Error rendering with mocked generation adapter.
- Build verification:
  - `npm run test:run`
  - `npm run build`

## Development Rules

- Write tests before production code for behavior-bearing modules.
- Keep the request adapter independent from React.
- Keep secrets out of previews and logs.
- Store the API key persistently only when the user enables the remember-key option.
- Keep the relay Base URL fixed to `https://api.tangguo.xin/v1`; do not expose a Base URL input.
- Show relay 504 responses as actionable upstream-timeout messages instead of rendering raw gateway HTML. The message should mention possible runtime platform, gateway/CDN, application timeout, or upstream-call log checks rather than assuming Nginx exists on the user's server.
- Do not add backend files in the first release.
- Do not implement image-to-image in the first release.
