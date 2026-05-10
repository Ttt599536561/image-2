import { describe, expect, it, vi } from 'vitest';
import { handler } from '../../../netlify/functions/generate';

describe('Netlify generate function', () => {
  it('adapts Netlify requests to the image proxy handler', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
    });

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        apiKey: 'sk-real-secret',
        request: {
          model: 'gpt-image-2',
          prompt: 'A lantern-lit studio',
          size: '1024x1024',
          quality: 'auto',
          background: 'auto',
          moderation: 'auto',
          n: 1,
        },
      }),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.tangguo.xin/v1/images/generations', expect.any(Object));
    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(response.body).toBe('{"data":[{"url":"https://cdn.example.com/image.png"}]}');
  });
});
