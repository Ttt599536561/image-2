import { createGenerateHandler } from '../../src/server/asyncImageJob';
import { getJobsStore } from '../../src/server/jobStore';

type NetlifyEvent = {
  httpMethod: string;
  body: string | null;
  fetchImpl?: typeof fetch;
};

type NetlifyResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  const handleGenerate = createGenerateHandler({
    jobsStore: getJobsStore(),
    triggerBackgroundJob,
  });

  const response = await handleGenerate({
    method: event.httpMethod,
    body: event.body ?? '',
  });

  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  };
}

async function triggerBackgroundJob(jobId: string, input: unknown): Promise<void> {
  const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!baseUrl) {
    throw new Error('Missing Netlify site URL for background function trigger.');
  }

  await fetch(`${baseUrl}/.netlify/functions/generate-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, input }),
  });
}
