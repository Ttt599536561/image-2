import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleImageProxyRequest } from './imageProxy';

const requestBody = {
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards requests to the configured relay image endpoint with the env-injected key', async () => {
    vi.stubEnv('RELAY_API_KEY', 'sk-real-secret');

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

  it('uses RELAY_BASE_URL when provided', async () => {
    vi.stubEnv('RELAY_API_KEY', 'sk-real-secret');
    vi.stubEnv('RELAY_BASE_URL', 'https://relay.internal.example.com/v1');

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
    });

    await handleImageProxyRequest({
      method: 'POST',
      body: JSON.stringify(requestBody),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://relay.internal.example.com/v1/images/generations',
      expect.anything(),
    );
  });

  it('redacts the env key from the relay response body', async () => {
    vi.stubEnv('RELAY_API_KEY', 'sk-real-secret');

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"echo":"Authorization: Bearer sk-real-secret"}',
    });

    const response = await handleImageProxyRequest({
      method: 'POST',
      body: JSON.stringify(requestBody),
      fetchImpl,
    });

    expect(response.body).toBe('{"echo":"Authorization: Bearer sk-***"}');
    expect(response.body).not.toContain('sk-real-secret');
  });

  it('returns 500 when RELAY_API_KEY is not configured', async () => {
    vi.stubEnv('RELAY_API_KEY', '');

    const fetchImpl = vi.fn();
    const response = await handleImageProxyRequest({
      method: 'POST',
      body: JSON.stringify(requestBody),
      fetchImpl,
    });

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'RELAY_API_KEY not configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
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
