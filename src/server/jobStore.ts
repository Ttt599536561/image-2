import { connectLambda, getStore } from '@netlify/blobs';
import type { JobRecord, JobsStore } from './asyncImageJob';

const STORE_NAME = 'image-generation-jobs';

export function connectJobsStore(event: unknown): void {
  connectLambda(event as { blobs: string; headers: Record<string, string> });
}

export function getJobsStore(): JobsStore {
  const store = getStore(STORE_NAME);

  return {
    async get(jobId: string) {
      return store.get(jobId, { type: 'json' });
    },
    async set(jobId: string, value: JobRecord) {
      await store.setJSON(jobId, value);
    },
  };
}
