# AI Image Workshop Design

Status: completed as the v1 design and superseded by the authenticated React Router `0.2.0` product. This document is historical context, not an active requirement set.

## Summary

Create a text-to-image website that lets users call the fixed One-API relay for GPT image generation. The first version focuses on matching the supplied UI references and keeping the request adapter isolated so relay-specific models such as `gpt-image-2` can be selected without breaking the official-compatible default.

## Architecture

The app is a Vite + React + TypeScript SPA. React owns UI state and presentation. A small adapter module owns request construction, proxy fetch behavior, response normalization, and future proxy swap points. Validation and storage are standalone library modules so they can be tested without rendering React.

## UI Design

The first screen is the generator itself. A white top navigation bar contains the product title and API config button. The main surface uses a light gray background and a centered two-column layout. The left card contains model, prompt, and parameter controls. The right card contains generation output and raw JSON.

The API config modal uses a dimmed blurred overlay, centered white panel, title row with icon and close button, quota callout, fixed relay display, API Key password field, helper copy, and a full-width black save button.

## Data Flow

1. App loads config from `localStorage`.
2. User enters only an API key in the modal and saves it.
3. User enters prompt and generation parameters.
4. App validates config and prompt.
5. On submit, app calls the local proxy adapter.
6. Adapter uses the fixed relay Base URL, sends fetch request, parses JSON, and extracts image outputs.
7. UI renders image outputs, errors, and raw response JSON.

## API Strategy

The implementation uses OpenAI Image API-compatible calls through the fixed relay:

```text
POST https://api.tangguo.xin/v1/images/generations
```

The adapter accepts a single generation input object. This allows a future backend proxy to reuse the same input object and replace only the transport function.

## Error Handling

Validation errors are shown before any network call. HTTP errors include status and parsed response text or JSON. Network failures use a message that explains the relay may not allow browser CORS. Response parsing errors explain that the relay response did not contain a supported image field.

## Security

The app never ships a hard-coded private key. API keys are only user-provided and are stored persistently only when the user enables the remember-key option. Errors and raw JSON panels redact keys as `sk-***`.

## Testing

Unit tests cover validation, storage, request building, network handling, and response parsing. Component tests cover modal behavior, validation flows, empty/loading/success/error result states, hidden debug controls, and mocked generation calls. Final verification runs the test suite and production build.
