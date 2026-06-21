import { describe, expect, it } from 'vitest';

import { createCurlPreview } from './curl';

const request = {
  model: 'gpt-image-2',
  prompt: 'A tiny gallery with linen curtains',
  size: '1024x1536',
  quality: 'high',
  background: 'transparent',
  moderation: 'low',
  n: 3,
};

describe('createCurlPreview', () => {
  it('uses the default image generation endpoint', () => {
    const curl = createCurlPreview({
      baseUrl: 'https://relay.example.com/v1/',
      apiKey: 'sk-real-secret',
      request,
    });

    expect(curl).toContain('https://relay.example.com/v1/images/generations');
  });

  it('includes selected request parameters as JSON', () => {
    const curl = createCurlPreview({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-real-secret',
      request,
    });

    expect(curl).toContain('"model": "gpt-image-2"');
    expect(curl).toContain('"prompt": "A tiny gallery with linen curtains"');
    expect(curl).toContain('"size": "1024x1536"');
    expect(curl).toContain('"quality": "high"');
    expect(curl).toContain('"background": "transparent"');
    expect(curl).toContain('"moderation": "low"');
    expect(curl).toContain('"n": 3');
  });

  it('redacts the API key and never includes the real secret', () => {
    const curl = createCurlPreview({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-real-secret',
      request,
    });

    expect(curl).toContain('Authorization: Bearer sk-***');
    expect(curl).not.toContain('sk-real-secret');
  });

  it('updates when request parameters change', () => {
    const curl = createCurlPreview({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-real-secret',
      request: {
        ...request,
        size: '1792x1024',
        quality: 'auto',
        background: 'auto',
        moderation: 'auto',
        n: 1,
      },
    });

    expect(curl).toContain('"size": "1792x1024"');
    expect(curl).toContain('"quality": "auto"');
    expect(curl).toContain('"background": "auto"');
    expect(curl).toContain('"moderation": "auto"');
    expect(curl).toContain('"n": 1');
  });
});
