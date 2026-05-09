# AI Image Workshop Design

## Summary

Create a pure frontend text-to-image website that lets users call their own API relay for `gpt-image-2`-style image generation. The first version focuses on matching the supplied UI references, supporting reliable request preview/debugging, and isolating the API adapter so a backend proxy can be added later.

## Architecture

The app will be a Vite + React + TypeScript SPA. React owns UI state and presentation. A small adapter module owns request construction, direct fetch behavior, response normalization, and future proxy swap points. Validation, storage, and CURL preview generation are standalone library modules so they can be tested without rendering React.

## UI Design

The first screen is the generator itself. A white top navigation bar contains the product title and API config button. The main surface uses a light gray background and a centered two-column layout. The left card contains model, prompt, and parameter controls. The right card contains generation output, CURL preview, and raw JSON.

The API config modal uses a dimmed blurred overlay, centered white panel, title row with icon and close button, quota callout, Base URL field, API Key password field, helper copy, and a full-width black save button.

## Data Flow

1. App loads config from `localStorage`.
2. User edits API config in the modal and saves it.
3. User enters prompt and generation parameters.
4. App validates config and prompt.
5. App builds a redacted CURL preview for display.
6. On submit, app calls the direct relay adapter.
7. Adapter normalizes Base URL, sends fetch request, parses JSON, and extracts image outputs.
8. UI renders image outputs, errors, and raw response JSON.

## API Strategy

The first implementation uses OpenAI Image API-compatible direct calls:

```text
POST {baseUrl}/images/generations
```

The adapter accepts a single generation input object. This allows a future backend proxy to reuse the same input object and replace only the transport function.

## Error Handling

Validation errors are shown before any network call. HTTP errors include status and parsed response text or JSON. Network failures use a message that explains the relay may not allow browser CORS. Response parsing errors explain that the relay response did not contain a supported image field.

## Security

The app never ships a hard-coded private key. API keys are only user-provided and stored locally after save. CURL preview redacts the key as `sk-***`. Raw JSON displays response content only, not request headers.

## Testing

Unit tests cover validation, storage, CURL redaction, request building, network handling, and response parsing. Component tests cover modal behavior, validation flows, empty/loading/success/error result states, and mocked generation calls. Final verification runs the test suite and production build.
