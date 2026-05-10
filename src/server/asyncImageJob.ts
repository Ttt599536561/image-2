import { handleImageProxyRequest, type ImageProxyInput, type ImageProxyResponse } from './imageProxy';

export type JobRecord =
  | {
      status: 'pending' | 'running';
      createdAt: string;
      updatedAt: string;
    }
  | {
      status: 'succeeded';
      response: ImageProxyResponse;
      createdAt: string;
      updatedAt: string;
    }
  | {
      status: 'failed';
      response: ImageProxyResponse;
      createdAt: string;
      updatedAt: string;
    };

export type JobsStore = {
  get(jobId: string): Promise<unknown | null>;
  set(jobId: string, value: JobRecord): Promise<void>;
};

export type ServerlessRequest = {
  method: string;
  body?: string | null;
  queryStringParameters?: Record<string, string | undefined> | null;
};

export type ServerlessResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type GenerateHandlerOptions = {
  createJobId?: () => string;
  jobsStore: JobsStore;
  triggerBackgroundJob: (jobId: string, input: ImageProxyInput) => Promise<void>;
};

type StatusHandlerOptions = {
  jobsStore: JobsStore;
};

type RunImageJobOptions = {
  jobId: string;
  input: ImageProxyInput;
  jobsStore: JobsStore;
  fetchImpl?: typeof fetch;
};

export function createGenerateHandler({
  createJobId = defaultCreateJobId,
  jobsStore,
  triggerBackgroundJob,
}: GenerateHandlerOptions) {
  return async function handleGenerateRequest(request: ServerlessRequest): Promise<ServerlessResponse> {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    let input: ImageProxyInput;
    try {
      input = JSON.parse(request.body ?? '') as ImageProxyInput;
    } catch {
      return jsonResponse(400, { error: 'Malformed JSON request body' });
    }

    const now = new Date().toISOString();
    const jobId = createJobId();

    await jobsStore.set(jobId, {
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    await triggerBackgroundJob(jobId, input);

    return jsonResponse(202, { jobId, status: 'pending' });
  };
}

export function createStatusHandler({ jobsStore }: StatusHandlerOptions) {
  return async function handleStatusRequest(request: ServerlessRequest): Promise<ServerlessResponse> {
    if (request.method !== 'GET') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    const jobId = request.queryStringParameters?.id;
    if (!jobId) {
      return jsonResponse(400, { error: 'Missing job id' });
    }

    const job = await jobsStore.get(jobId);
    if (!isJobRecord(job)) {
      return jsonResponse(404, { error: 'Job not found' });
    }

    switch (job.status) {
      case 'pending':
      case 'running':
        return jsonResponse(200, { status: job.status });
      case 'succeeded':
      case 'failed':
        return jsonResponse(200, {
          status: job.status,
          response: job.response,
        });
    }
  };
}

export async function runImageJob({
  jobId,
  input,
  jobsStore,
  fetchImpl = fetch,
}: RunImageJobOptions): Promise<void> {
  const job = await jobsStore.get(jobId);
  if (!isJobRecord(job) || (job.status !== 'pending' && job.status !== 'running')) {
    return;
  }

  await jobsStore.set(jobId, {
    ...job,
    status: 'running',
    updatedAt: new Date().toISOString(),
  });

  const response = await handleImageProxyRequest({
    method: 'POST',
    body: JSON.stringify(input),
    fetchImpl,
  });

  const finishedAt = new Date().toISOString();
  await jobsStore.set(jobId, {
    status: response.status >= 200 && response.status < 300 ? 'succeeded' : 'failed',
    response,
    createdAt: job.createdAt,
    updatedAt: finishedAt,
  });
}

export function jsonResponse(status: number, payload: unknown): ServerlessResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function defaultCreateJobId(): string {
  return crypto.randomUUID();
}

function isJobRecord(value: unknown): value is JobRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Partial<JobRecord>;
  return record.status === 'pending' || record.status === 'running' || record.status === 'succeeded' || record.status === 'failed';
}
