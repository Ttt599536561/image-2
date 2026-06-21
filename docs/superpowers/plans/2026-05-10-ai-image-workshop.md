# AI Image Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static React text-to-image website that matches the supplied reference UI and calls a user-configured API relay.

**Architecture:** The app is a Vite + React + TypeScript SPA. UI components are separated from a tested request adapter, validation helpers, storage helpers, and redacted CURL preview generation. The direct relay adapter is the only module that must change when a future backend proxy is added.

**Tech Stack:** Vite, React, TypeScript, Vitest, React Testing Library, lucide-react.

---

## File Structure

- Create: `package.json` for scripts and dependencies.
- Create: `index.html` for Vite mounting.
- Create: `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts` for TypeScript, Vite, and tests.
- Create: `src/main.tsx` as app entry.
- Create: `src/App.tsx` as stateful page coordinator.
- Create: `src/styles.css` for all layout and visual styling.
- Create: `src/api/imageGeneration.ts` for payloads, endpoint building, fetch transport, and response parsing.
- Create: `src/lib/validation.ts` for form/config validation.
- Create: `src/lib/curl.ts` for redacted CURL preview.
- Create: `src/lib/storage.ts` for localStorage access.
- Create: `src/lib/redaction.ts` for secret redaction before visible debug output.
- Create: `src/hooks/useApiConfig.ts` for persisted config state.
- Create: `src/components/ApiConfigModal.tsx` for modal UI.
- Create: `src/components/GeneratorForm.tsx` for parameter controls.
- Create: `src/components/ResultPanel.tsx` for output/debug UI.
- Create: `src/test/setup.ts` for testing-library setup.
- Create tests under `src/**/*.test.ts` and `src/**/*.test.tsx`.

## Task 1: Project Scaffold and Core Utilities

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/lib/validation.test.ts`
- Create: `src/lib/validation.ts`
- Create: `src/lib/storage.test.ts`
- Create: `src/lib/storage.ts`

- [ ] **Step 1: Write failing validation and storage tests**

Create `src/lib/validation.test.ts` with tests for API config validation, prompt validation, quantity bounds, and Base URL normalization.

Create `src/lib/storage.test.ts` with tests for default config, saved config, and unavailable storage fallback.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/validation.test.ts src/lib/storage.test.ts --run`

Expected: Tests fail because the modules do not exist yet.

- [ ] **Step 3: Add project scaffold and minimal utility implementation**

Create the Vite/React/TypeScript configuration files and utility modules. Implement:

- `DEFAULT_API_CONFIG`
- `validateApiConfig`
- `validateGenerationInput`
- `normalizeBaseUrl`
- `loadApiConfig`
- `saveApiConfig`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/validation.test.ts src/lib/storage.test.ts --run`

Expected: All validation and storage tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json index.html tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts src/test/setup.ts src/lib/validation.ts src/lib/validation.test.ts src/lib/storage.ts src/lib/storage.test.ts
git commit -m "chore: scaffold app and core utilities"
```

## Task 2: API Adapter and CURL Preview

**Files:**
- Create: `src/api/imageGeneration.test.ts`
- Create: `src/api/imageGeneration.ts`
- Create: `src/lib/curl.test.ts`
- Create: `src/lib/curl.ts`

- [ ] **Step 1: Write failing adapter and CURL tests**

Create tests that prove:

- Endpoint joins normalized Base URL with `/images/generations`.
- Payload contains model, prompt, size, quality, background, moderation, and quantity.
- Fetch sends POST, JSON, and bearer token headers.
- HTTP failures include status information.
- Fetch rejection becomes a CORS/network hint.
- Malformed JSON responses become a clear malformed-response error.
- Response parser supports `data[].url`, `data[].b64_json`, and `output` image values.
- CURL preview redacts the API key.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/imageGeneration.test.ts src/lib/curl.test.ts --run`

Expected: Tests fail because the modules do not exist yet.

- [ ] **Step 3: Implement adapter and CURL preview**

Implement:

- `buildImageGenerationPayload`
- `buildImageGenerationUrl`
- `parseImageGenerationResponse`
- `generateImage`
- `createCurlPreview`

The adapter must accept a custom `fetchImpl` for tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/imageGeneration.test.ts src/lib/curl.test.ts --run`

Expected: Adapter and CURL tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/api/imageGeneration.ts src/api/imageGeneration.test.ts src/lib/curl.ts src/lib/curl.test.ts
git commit -m "feat: add image generation adapter"
```

## Task 3: React Components and App State

**Files:**
- Create: `src/hooks/useApiConfig.ts`
- Create: `src/components/ApiConfigModal.tsx`
- Create: `src/components/GeneratorForm.tsx`
- Create: `src/components/ResultPanel.tsx`
- Create: `src/App.test.tsx`
- Create: `src/App.tsx`
- Create: `src/main.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/App.test.tsx` to cover:

- API modal opens from the header button.
- API config saves and closes.
- Missing prompt validation renders `请先填写图片描述`.
- Missing API key validation renders `请先填写 API Key`.
- Successful mocked generation renders an image.
- Successful mocked generation renders a download control for the image.
- Failed mocked generation renders error text.
- CURL preview shows `sk-***` and not the real API key.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/App.test.tsx --run`

Expected: Tests fail because components do not exist yet.

- [ ] **Step 3: Implement React UI and state**

Implement:

- Header with product title and config button.
- API config modal.
- Text-to-image form with disabled image-to-image tab.
- Result panel with empty/loading/success/error states.
- Collapsible CURL and raw JSON sections.
- Injection point for `generateImage` so tests can mock generation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/App.test.tsx --run`

Expected: Component tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/hooks/useApiConfig.ts src/components/ApiConfigModal.tsx src/components/GeneratorForm.tsx src/components/ResultPanel.tsx src/App.tsx src/App.test.tsx src/main.tsx
git commit -m "feat: build generator interface"
```

## Task 4: Styling, Responsive Polish, and Final Verification

**Files:**
- Create: `src/styles.css`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: component files if class names or accessibility labels need adjustment.

- [ ] **Step 1: Write or update UI assertions for accessible labels**

Add test assertions only where needed to lock in labels used by users:

- Header config button has accessible name `中转站 API 配置`.
- Modal title is visible.
- Generate button has text `开始创作`.

- [ ] **Step 2: Run tests to verify they fail if labels/classes are missing**

Run: `npm test -- src/App.test.tsx --run`

Expected: Tests fail only if required labels are missing.

- [ ] **Step 3: Add final CSS and accessibility polish**

Create `src/styles.css` and import it from `src/main.tsx`. Match the reference visual system:

- Light gray page background.
- White header and cards.
- Two-column desktop grid.
- Single-column mobile layout.
- Black primary buttons.
- Thin borders.
- Modal overlay blur/dim.
- Compact form fields.
- Non-overlapping long text behavior.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run test:run
npm run build
```

Expected: Tests pass and production build succeeds.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/styles.css src/main.tsx src/App.tsx src/components src/App.test.tsx
git commit -m "style: polish responsive generator UI"
```

## Final Review Gate

- Dispatch a spec compliance reviewer against `docs/requirements.md`, `docs/development.md`, `docs/test-cases.md`, and the implementation.
- Dispatch a code quality reviewer against the final diff.
- Fix all critical and important issues.
- Re-run:

```bash
npm run test:run
npm run build
```

Only after both commands succeed and both reviewers approve may the work be reported complete.
