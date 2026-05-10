import {
  parseImageGenerationResponse,
  type GenerateImageOptions,
  type GenerateImageResult,
} from './imageGeneration';
import { redactText } from '../lib/redaction';

export async function generateImageViaProxy({
  baseUrl,
  apiKey,
  request,
  fetchImpl = fetch,
}: GenerateImageOptions): Promise<GenerateImageResult> {
  let response: Response;

  try {
    response = await fetchImpl('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baseUrl, apiKey, request }),
    });
  } catch {
    throw new Error('Proxy request failed. Check the local server and network connectivity.');
  }

  if (!response.ok) {
    const details = redactText(await response.text(), [apiKey]);
    throw new Error(formatProxyFailure(response.status, details));
  }

  let rawResponse: unknown;
  try {
    rawResponse = await response.json();
  } catch {
    throw new Error('Proxy returned malformed JSON.');
  }

  return {
    images: parseImageGenerationResponse(rawResponse),
    rawResponse,
  };
}

function formatProxyFailure(status: number, details: string): string {
  if (status === 504) {
    return '中转站网关超时（HTTP 504）。请求已到达中转站，但中转站或其网关/CDN 等待上游响应超时。请稍后重试，或检查中转站运行平台、网关/CDN、应用层请求超时和上游调用日志。';
  }

  return `Proxy request failed with HTTP ${status}: ${details}`;
}
