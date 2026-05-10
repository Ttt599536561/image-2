import { runImageJob } from '../../src/server/asyncImageJob';
import type { ImageProxyInput } from '../../src/server/imageProxy';
import { getJobsStore } from '../../src/server/jobStore';

type NetlifyEvent = {
  body: string | null;
};

type NetlifyResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  const payload = JSON.parse(event.body ?? '{}') as { jobId?: string; input?: ImageProxyInput };

  if (!payload.jobId || !payload.input) {
    return jsonResponse(400, { error: 'Missing job input' });
  }

  await runImageJob({
    jobId: payload.jobId,
    input: payload.input,
    jobsStore: getJobsStore(),
  });

  return jsonResponse(202, { status: 'accepted' });
}

function jsonResponse(statusCode: number, payload: unknown): NetlifyResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
