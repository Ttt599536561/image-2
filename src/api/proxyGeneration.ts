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
  pollIntervalMs = 2000,
}: GenerateImageOptions): Promise<GenerateImageResult> {
  let response: Response;

  try {
    response = await fetchImpl('/.netlify/functions/generate', {
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
    throw new Error(formatProxyFailure(response.status, details, request.model));
  }

  const jobStart = await readJson(response, 'Proxy returned malformed JSON.');
  const jobId = getJobId(jobStart);
  if (!jobId) {
    return {
      images: parseImageGenerationResponse(jobStart),
      rawResponse: jobStart,
    };
  }

  const rawResponse = await pollImageJob({
    jobId,
    apiKey,
    fetchImpl,
    pollIntervalMs,
    model: request.model,
  });

  return {
    images: parseImageGenerationResponse(rawResponse),
    rawResponse,
  };
}

async function pollImageJob({
  jobId,
  apiKey,
  fetchImpl,
  pollIntervalMs,
  model,
}: {
  jobId: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  pollIntervalMs: number;
  model: string;
}): Promise<unknown> {
  const maxAttempts = 450;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(pollIntervalMs);
    }

    const response = await fetchImpl(`/.netlify/functions/generate-status?id=${encodeURIComponent(jobId)}`);

    if (!response.ok) {
      const details = redactText(await response.text(), [apiKey]);
      throw new Error(formatProxyFailure(response.status, details, model));
    }

    const statusPayload = await readJson(response, 'Proxy status endpoint returned malformed JSON.');

    if (!isRecord(statusPayload)) {
      throw new Error('Proxy status endpoint returned malformed JSON.');
    }

    if (statusPayload.status === 'pending' || statusPayload.status === 'running') {
      continue;
    }

    if ((statusPayload.status === 'succeeded' || statusPayload.status === 'failed') && isProxyResponse(statusPayload.response)) {
      if (statusPayload.response.status < 200 || statusPayload.response.status >= 300) {
        const details = redactText(statusPayload.response.body, [apiKey]);
        throw new Error(formatProxyFailure(statusPayload.response.status, details, model));
      }

      return parseJsonText(statusPayload.response.body);
    }

    throw new Error('Proxy status endpoint returned malformed JSON.');
  }

  throw new Error('Image generation timed out while waiting for the Netlify background job.');
}

async function readJson(response: Response, message: string): Promise<unknown> {
  let rawResponse: unknown;
  try {
    rawResponse = await response.json();
  } catch {
    throw new Error(message);
  }

  return rawResponse;
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Proxy returned malformed JSON.');
  }
}

function getJobId(value: unknown): string | null {
  if (isRecord(value) && typeof value.jobId === 'string') {
    return value.jobId;
  }

  return null;
}

function isProxyResponse(value: unknown): value is { status: number; body: string } {
  return isRecord(value) && typeof value.status === 'number' && typeof value.body === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatProxyFailure(status: number, details: string, model: string): string {
  if (status === 404) {
    return 'Netlify function route was not found. Redeploy from GitHub and confirm netlify/functions/generate.ts is included in the deployed branch.';
  }

  if (status === 502 && details.includes('upstream_error')) {
    return `中转站上游请求失败（HTTP 502）。请确认中转站是否支持当前模型 ${model}，以及该模型在中转站到上游的映射、额度和权限是否可用。原始错误：${details}`;
  }

  if (status === 504) {
    return '中转站网关超时（HTTP 504）。请求已到达中转站，但中转站或其网关/CDN 等待上游响应超时。请稍后重试，或检查中转站运行平台、网关/CDN、应用层请求超时和上游调用日志。';
  }

  return `Proxy request failed with HTTP ${status}: ${details}`;
}
