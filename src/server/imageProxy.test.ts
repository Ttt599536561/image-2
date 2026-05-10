import { describe, expect, it, vi } from 'vitest';
import { handleImageProxyRequest } from './imageProxy';

const requestBody = {
  baseUrl: 'https://untrusted-relay.example.com/v1',
  apiKey: 'sk-real-secret',
  request: {
    model: 'gpt-image-2',
    prompt: 'A quiet mountain observatory',
    size: '1024x1024',
    quality: 'auto',
    background: 'auto',
    moderation: 'auto',
    n: 4,
  },
};

describe('handleImageProxyRequest', () => {
  it('forwards requests to the configured relay image endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
    });

    const response = await handleImageProxyRequest({
      method: 'POST',
      body: JSON.stringify(requestBody),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.tangguo.xin/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-real-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...requestBody.request, n: 1 }),
    });
    expect(response.status).toBe(200);
    expect(response.body).toBe('{"data":[{"url":"https://cdn.example.com/image.png"}]}');
  });

  it('returns 405 for non-POST requests', async () => {
    const response = await handleImageProxyRequest({
      method: 'GET',
      body: '',
      fetchImpl: vi.fn(),
    });

    expect(response.status).toBe(405);
  });
});
