import { describe, expect, it, vi } from 'vitest';

import {
  buildImageGenerationPayload,
  buildImageGenerationUrl,
  generateImage,
  parseImageGenerationResponse,
} from './imageGeneration';

const generationInput = {
  model: 'gpt-image-2',
  prompt: 'A quiet ceramic studio at sunrise',
  size: '1024x1024',
  quality: 'auto',
  background: 'auto',
  moderation: 'auto',
  n: 2,
};

describe('buildImageGenerationUrl', () => {
  it('joins a normalized base URL with the default image generation endpoint', () => {
    expect(buildImageGenerationUrl('https://relay.example.com/v1/')).toBe(
      'https://relay.example.com/v1/images/generations',
    );
  });
});

describe('buildImageGenerationPayload', () => {
  it('includes the image generation parameters expected by the relay', () => {
    expect(buildImageGenerationPayload(generationInput)).toEqual(generationInput);
  });
});

describe('parseImageGenerationResponse', () => {
  it('parses data entries with image URLs', () => {
    const images = parseImageGenerationResponse({
      data: [{ url: 'https://cdn.example.com/image-a.png' }],
    });

    expect(images).toEqual([
      { src: 'https://cdn.example.com/image-a.png', kind: 'url' },
    ]);
  });

  it('parses base64 JSON image entries into data URLs', () => {
    const images = parseImageGenerationResponse({
      data: [{ b64_json: 'aW1hZ2U=' }],
    });

    expect(images).toEqual([
      { src: 'data:image/png;base64,aW1hZ2U=', kind: 'base64' },
    ]);
  });

  it('parses multiple supported entries from data arrays', () => {
    const images = parseImageGenerationResponse({
      data: [
        { url: 'https://cdn.example.com/image-a.png' },
        { b64_json: 'aW1hZ2UtYg==' },
      ],
    });

    expect(images).toEqual([
      { src: 'https://cdn.example.com/image-a.png', kind: 'url' },
      { src: 'data:image/png;base64,aW1hZ2UtYg==', kind: 'base64' },
    ]);
  });

  it('permissively parses output arrays containing image URL and base64 values', () => {
    const images = parseImageGenerationResponse({
      output: [
        'https://cdn.example.com/from-output.png',
        { image_url: 'https://cdn.example.com/object-output.png' },
        { b64_json: 'b3V0cHV0LWJhc2U2NA==' },
      ],
    });

    expect(images).toEqual([
      { src: 'https://cdn.example.com/from-output.png', kind: 'url' },
      { src: 'https://cdn.example.com/object-output.png', kind: 'url' },
      { src: 'data:image/png;base64,b3V0cHV0LWJhc2U2NA==', kind: 'base64' },
    ]);
  });

  it('throws a clear error when no supported image is found', () => {
    expect(() => parseImageGenerationResponse({ data: [{ text: 'no image' }] })).toThrow(
      'No supported image output found in the response.',
    );
  });
});

describe('generateImage', () => {
  it('sends a POST request with JSON body and bearer authorization', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
    });

    const result = await generateImage({
      baseUrl: 'https://relay.example.com/v1/',
      apiKey: 'sk-real-secret',
      request: generationInput,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://relay.example.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-real-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(generationInput),
      },
    );
    expect(result.images).toEqual([
      { src: 'https://cdn.example.com/image.png', kind: 'url' },
    ]);
    expect(result.rawResponse).toEqual({
      data: [{ url: 'https://cdn.example.com/image.png' }],
    });
  });

  it('throws an HTTP error with status and response details for non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => '{"error":"quota exceeded"}',
    });

    await expect(
      generateImage({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Image generation request failed with HTTP 429: {"error":"quota exceeded"}');
  });

  it('redacts the API key from HTTP failure details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"echoed":"Authorization: Bearer sk-real-secret"}',
    });

    await expect(
      generateImage({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Image generation request failed with HTTP 400: {"echoed":"Authorization: Bearer sk-***"}');
  });

  it('throws a CORS and network hint when fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      generateImage({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Network request failed. Check the relay URL and CORS configuration.');
  });

  it('throws a malformed-response error when success JSON parsing fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    await expect(
      generateImage({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Relay returned malformed JSON.');
  });
});
