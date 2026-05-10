import { describe, expect, it, vi } from 'vitest';
import { createGenerateHandler, createStatusHandler, runImageJob } from './asyncImageJob';

const requestBody = {
  baseUrl: 'https://api.tangguo.xin/v1',
  apiKey: 'sk-real-secret',
  request: {
    model: 'gpt-image-2',
    prompt: 'A quiet mountain observatory',
    size: '1024x1024',
    quality: 'auto',
    background: 'auto',
    moderation: 'auto',
    n: 1,
  },
};

function createMemoryJobsStore(initial: Record<string, unknown> = {}) {
  const jobs = new Map(Object.entries(initial));

  return {
    async get(jobId: string) {
      return jobs.get(jobId) ?? null;
    },
    async set(jobId: string, value: unknown) {
      jobs.set(jobId, value);
    },
  };
}

describe('async image jobs', () => {
  it('creates an accepted job and triggers the background function', async () => {
    const jobsStore = createMemoryJobsStore();
    const triggerBackgroundJob = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateHandler({
      createJobId: () => 'job-123',
      jobsStore,
      triggerBackgroundJob,
    });

    const response = await handler({
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ jobId: 'job-123', status: 'pending' });
    expect(await jobsStore.get('job-123')).toMatchObject({ status: 'pending' });
    expect(await jobsStore.get('job-123')).not.toMatchObject({
      input: expect.objectContaining({ apiKey: 'sk-real-secret' }),
    });
    expect(triggerBackgroundJob).toHaveBeenCalledWith('job-123', requestBody);
  });

  it('runs the image request in the background and stores the successful result', async () => {
    const jobsStore = createMemoryJobsStore({
      'job-123': {
        status: 'pending',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
    });

    await runImageJob({
      jobId: 'job-123',
      input: requestBody,
      jobsStore,
      fetchImpl,
    });

    expect(await jobsStore.get('job-123')).toMatchObject({
      status: 'succeeded',
      response: {
        status: 200,
        body: '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
      },
    });
  });

  it('reads a completed job through the status handler', async () => {
    const jobsStore = createMemoryJobsStore({
      'job-123': {
        status: 'succeeded',
        response: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
        },
      },
    });
    const handler = createStatusHandler({ jobsStore });

    const response = await handler({
      method: 'GET',
      queryStringParameters: { id: 'job-123' },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: 'succeeded',
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"data":[{"url":"https://cdn.example.com/image.png"}]}',
      },
    });
  });
});
