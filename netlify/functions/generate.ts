import { handleImageProxyRequest } from '../../src/server/imageProxy';

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
  const proxyResponse = await handleImageProxyRequest({
    method: event.httpMethod,
    body: event.body ?? '',
    fetchImpl: event.fetchImpl ?? fetch,
  });

  return {
    statusCode: proxyResponse.status,
    headers: proxyResponse.headers,
    body: proxyResponse.body,
  };
}
