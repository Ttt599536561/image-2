# AI Image Workshop Test Cases

> **Note (2026-06-20):** The cases below cover the current **v1 two-column UI** and its logic. The planned Composer redesign ([redesign-requirements.md](redesign-requirements.md)) will need new component/UI cases (composer states, history recall, session image panel). The unit/server/proxy cases below largely carry over unchanged.

## Unit Test Cases

### API Config Validation

1. Empty API key fails with `请先填写 API Key`.
2. Fixed relay Base URL is used internally.

### Generation Form Validation

1. Empty prompt fails with `请先填写图片描述`.
2. Whitespace-only prompt fails.
3. Prompt with visible text passes.
4. Quantity remains fixed to `1`.

### Response Parsing

1. Parses `data[0].url`.
2. Parses `data[0].b64_json` into a data URL.
3. Parses multiple entries in `data`.
4. Parses `output` arrays containing image URL values.
5. Throws a clear error when no image can be found.

### Direct Relay Adapter (`generateImage`, test-only path)

1. Sends POST to `{baseUrl}/images/generations`.
2. Sends JSON body with UI parameters.
3. Sends bearer authorization header.
4. Parses JSON on success.
5. Throws HTTP error with response details on non-2xx.
6. Redacts the API key from HTTP failure details.
7. Throws CORS/network hint when fetch rejects.
8. Throws a malformed-response error when the response body is not valid JSON.

### Proxy Transport (`proxyGeneration`, the live UI path)

1. Starts an async Netlify job (`POST /.netlify/functions/generate`) and polls
   `GET /.netlify/functions/generate-status?id=…` until the image is available.
2. Returns immediately (no polling) when the proxy reply has no `jobId`
   (synchronous dev path).
3. Redacts the API key from proxy HTTP failure details.
4. Explains 404 responses as a missing Netlify function route.
5. Explains upstream 502 (`upstream_error`) as a relay/model compatibility issue,
   naming the requested model.
6. Converts gateway-style HTTP 504 HTML into an actionable relay timeout message
   without assuming Nginx exists on the user's server (strips raw HTML).

### Server Proxy (`imageProxy`)

1. Forwards POST requests to the fixed relay `https://api.tangguo.xin/v1/images/generations`,
   ignoring any client-supplied Base URL.
2. Forces quantity to `1` regardless of the requested `n`.
3. Sends the bearer authorization header and returns the relay status/body.
4. Returns 405 for non-POST requests.

### Async Image Jobs (`asyncImageJob`)

1. `generate` creates a `pending` job, returns `202 {jobId, status:'pending'}`, and
   triggers the background function — without storing the API key in the job record.
2. `runImageJob` runs the relay request in the background and stores the successful
   result (`succeeded` with the response body).
3. `status` reads a completed job and returns its stored response.

### Secret Redaction

1. Redacts exact user-provided secrets to `sk-***`.
2. Redacts generic `sk-...` bearer tokens to `sk-***`.
3. Redacts nested response values without mutating the original object.

### Storage

1. Reads defaults when storage is empty.
2. Ignores stale stored custom Base URLs.
3. Saves API key only when remember-key is enabled.
4. Handles unavailable localStorage without crashing.

## Component Test Cases

### API Config Modal

1. Opens when the header config button is clicked.
2. Shows fixed relay Base URL as read-only text.
3. Saves entered API Key.
4. Closes after save.
5. Masks API key input.
6. Can close with close button.
7. Can close with Escape.
8. Does not persist the API key unless remember-key is enabled.

### Generator Form

1. Renders text-to-image tab as active.
2. Clicking image-to-image tab shows a "developing" toast.
3. Shows model selector.
4. Shows prompt textarea.
5. Shows model, prompt, friendly size, quality, background, and moderation controls.
6. Hides quantity and return-format controls.
7. Submit button is disabled while generating.

### Result Panel

1. Empty state shows `开始你的创作之旅`.
2. Loading state appears during request.
3. Success state shows returned generated image.
4. Error state shows concise error message.
5. Raw JSON collapsible section displays redacted response after request.
6. CURL section is hidden from the UI.
7. Generated URL and data URL images expose download controls.

## Manual Verification Cases

1. Desktop layout matches the reference two-column composition.
2. Mobile layout stacks the form and result panels without overlap.
3. API modal matches the reference modal hierarchy and spacing.
4. Long prompts do not break the layout.
5. Missing API config produces a helpful error.
6. Simulated CORS failure produces a CORS/network hint.
7. Generated base64 image is visible and downloadable.
8. Generated URL image is visible and downloadable.
