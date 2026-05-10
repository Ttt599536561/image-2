import { describe, expect, it, vi } from 'vitest';
import { generateImageViaProxy } from './proxyGeneration';

const generationInput = {
  model: 'gpt-image-2',
  prompt: 'A moonlit tea room',
  size: '1024x1024',
  quality: 'auto',
  background: 'auto',
  moderation: 'auto',
  n: 1,
};

describe('generateImageViaProxy', () => {
  it('starts an async Netlify job and polls until the generated image is available', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-123', status: 'pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'running',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'succeeded',
          response: {
            status: 200,
            body: JSON.stringify({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
          },
        }),
      });

    const result = await generateImageViaProxy({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-real-secret',
      request: generationInput,
      fetchImpl,
      pollIntervalMs: 0,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/.netlify/functions/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
      }),
    });
    expect(fetchImpl).toHaveBeenCalledWith('/.netlify/functions/generate-status?id=job-123');
    expect(result.images).toEqual([{ src: 'https://cdn.example.com/image.png', kind: 'url' }]);
  });

  it('redacts proxy HTTP failure details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '{"echo":"Authorization: Bearer sk-real-secret"}',
    });

    await expect(
      generateImageViaProxy({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Proxy request failed with HTTP 502: {"echo":"Authorization: Bearer sk-***"}');
  });

  it('explains 404 responses as a missing Netlify function route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '',
    });

    await expect(
      generateImageViaProxy({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      }),
    ).rejects.toThrow('Netlify function route was not found');
  });

  it('explains upstream 502 failures from the relay', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '{"error":{"message":"Upstream request failed","type":"upstream_error"}}',
    });

    await expect(
      generateImageViaProxy({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: { ...generationInput, model: 'gpt-image-2' },
        fetchImpl,
      }),
    ).rejects.toThrow('中转站上游请求失败（HTTP 502）。请确认中转站是否支持当前模型 gpt-image-2');
  });

  it('turns nginx 504 HTML into an actionable relay timeout message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      statusText: 'Gateway Time-out',
      text: async () =>
        '<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1><hr><center>nginx/1.22.1</center></body></html>',
    });

    let errorMessage = '';

    try {
      await generateImageViaProxy({
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-real-secret',
        request: generationInput,
        fetchImpl,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain('中转站网关超时');
    expect(errorMessage).toContain('HTTP 504');
    expect(errorMessage).toContain('网关/CDN');
    expect(errorMessage).not.toContain('Nginx/proxy/read timeout');
    expect(errorMessage).not.toMatch(/<html|<body|nginx\/1\.22\.1/i);
  });
});
