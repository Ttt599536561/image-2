import { createGenerateHandler } from '../../src/server/asyncImageJob';
import { connectJobsStore, getJobsStore } from '../../src/server/jobStore';

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
  connectJobsStore(event);

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
  // 本地 netlify dev 下 URL/DEPLOY_PRIME_URL 可能缺失 → 回退本地；都缺失才抛错（F-trigger）。
  const baseUrl =
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (process.env.NETLIFY_DEV ? 'http://localhost:8888' : undefined);
  if (!baseUrl) {
    throw new Error('Missing Netlify site URL for background function trigger.');
  }

  // fire-and-forget：job 已写入 Blobs、202 已可返回，触发失败只记日志、不阻塞、不抛。
  void fetch(`${baseUrl}/.netlify/functions/generate-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, input }),
  }).catch((error) => {
    console.error('triggerBackgroundJob failed', error);
  });
}
