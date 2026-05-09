# AI Image Workshop Test Cases

## Unit Test Cases

### API Config Validation

1. Empty API key fails with `请先填写 API Key`.
2. Empty Base URL fails with `请先填写请求地址`.
3. Non-HTTP Base URL fails with `请求地址必须以 http:// 或 https:// 开头`.
4. Valid HTTPS Base URL and non-empty key passes.
5. Base URL with trailing slash normalizes without duplicate slashes.

### Generation Form Validation

1. Empty prompt fails with `请先填写图片描述`.
2. Whitespace-only prompt fails.
3. Prompt with visible text passes.
4. Quantity below 1 is rejected.
5. Quantity above 4 is rejected.

### CURL Preview

1. CURL uses `{baseUrl}/images/generations`.
2. CURL contains selected model and prompt.
3. CURL contains `Authorization: Bearer sk-***` and never contains the real key.
4. CURL updates when size, quality, background, moderation, or quantity changes.

### Response Parsing

1. Parses `data[0].url`.
2. Parses `data[0].b64_json` into a data URL.
3. Parses multiple entries in `data`.
4. Parses `output` arrays containing image URL values.
5. Throws a clear error when no image can be found.

### Network Adapter

1. Sends POST to normalized `/images/generations`.
2. Sends JSON body with UI parameters.
3. Sends bearer authorization header.
4. Parses JSON on success.
5. Throws HTTP error with response details on non-2xx.
6. Throws CORS/network hint when fetch rejects.
7. Throws a malformed-response error when the response body is not valid JSON.

### Storage

1. Reads defaults when storage is empty.
2. Saves Base URL and API key after user action.
3. Handles unavailable localStorage without crashing.

## Component Test Cases

### API Config Modal

1. Opens when the header config button is clicked.
2. Shows default Base URL.
3. Saves entered Base URL and API Key.
4. Closes after save.
5. Masks API key input.
6. Can close with close button.

### Generator Form

1. Renders text-to-image tab as active.
2. Renders image-to-image tab as disabled placeholder.
3. Shows model selector.
4. Shows prompt textarea.
5. Shows size, quantity, quality, background, moderation, and return-format controls.
6. Submit button is disabled while generating.

### Result Panel

1. Empty state shows `开始你的创作之旅`.
2. Loading state appears during request.
3. Success state shows returned generated image.
4. Error state shows concise error message.
5. Raw JSON collapsible section displays response after request.
6. CURL section includes redacted preview and copy button.
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
