import { createStatusHandler } from '../../src/server/asyncImageJob';
import { connectJobsStore, getJobsStore } from '../../src/server/jobStore';

type NetlifyEvent = {
  httpMethod: string;
  queryStringParameters: Record<string, string | undefined> | null;
};

type NetlifyResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  connectJobsStore(event);

  const handleStatus = createStatusHandler({
    jobsStore: getJobsStore(),
  });

  const response = await handleStatus({
    method: event.httpMethod,
    queryStringParameters: event.queryStringParameters,
  });

  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  };
}
