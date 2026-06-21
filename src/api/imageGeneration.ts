export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  background: string;
  moderation: string;
  n: number;
};

export type ParsedImage = {
  src: string;
  kind: 'url' | 'base64';
};

// Proxy 路径选项（铁律④：客户端不再持有 baseUrl/apiKey，仅发 request）。
export type GenerateImageOptions = {
  request: ImageGenerationRequest;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
};

// 旧的直连客户端路径（应用未使用，仅保留单测）：仍需 baseUrl/apiKey 直接打中转。
export type DirectGenerateImageOptions = {
  baseUrl: string;
  apiKey: string;
  request: ImageGenerationRequest;
  fetchImpl?: typeof fetch;
};

export type GenerateImageResult = {
  images: ParsedImage[];
  rawResponse: unknown;
};

const DEFAULT_IMAGE_GENERATION_PATH = '/images/generations';
const IMAGE_DATA_URL_PREFIX = 'data:image/png;base64,';

export function buildImageGenerationPayload(
  request: ImageGenerationRequest,
): ImageGenerationRequest {
  return {
    model: request.model,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    background: request.background,
    moderation: request.moderation,
    n: request.n,
  };
}

export function buildImageGenerationUrl(
  baseUrl: string,
  endpointPath = DEFAULT_IMAGE_GENERATION_PATH,
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function parseImageGenerationResponse(response: unknown): ParsedImage[] {
  const images: ParsedImage[] = [];

  if (isRecord(response) && Array.isArray(response.data)) {
    for (const item of response.data) {
      collectImageValue(item, images);
    }
  }

  if (isRecord(response) && Array.isArray(response.output)) {
    for (const item of response.output) {
      collectImageValue(item, images);
    }
  }

  if (images.length === 0) {
    throw new Error('No supported image output found in the response.');
  }

  return images;
}

export async function generateImage({
  baseUrl,
  apiKey,
  request,
  fetchImpl = fetch,
}: DirectGenerateImageOptions): Promise<GenerateImageResult> {
  let response: Response;

  try {
    response = await fetchImpl(buildImageGenerationUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildImageGenerationPayload(request)),
    });
  } catch {
    throw new Error('Network request failed. Check the relay URL and CORS configuration.');
  }

  if (!response.ok) {
    const details = redactText(await readFailureBody(response), [apiKey]);
    throw new Error(
      `Image generation request failed with HTTP ${response.status}: ${details}`,
    );
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new Error('Relay returned malformed JSON.');
  }

  return {
    images: parseImageGenerationResponse(rawResponse),
    rawResponse,
  };
}

function collectImageValue(value: unknown, images: ParsedImage[]): void {
  if (typeof value === 'string') {
    collectImageString(value, images);
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.url === 'string') {
    images.push({ src: value.url, kind: 'url' });
  }

  if (typeof value.image_url === 'string') {
    images.push({ src: value.image_url, kind: 'url' });
  }

  if (typeof value.b64_json === 'string') {
    images.push({ src: toImageDataUrl(value.b64_json), kind: 'base64' });
  }
}

function collectImageString(value: string, images: ParsedImage[]): void {
  if (isHttpUrl(value) || value.startsWith('data:image/')) {
    images.push({ src: value, kind: 'url' });
    return;
  }

  if (looksLikeBase64(value)) {
    images.push({ src: toImageDataUrl(value), kind: 'base64' });
  }
}

async function readFailureBody(response: Response): Promise<string> {
  if (typeof response.text !== 'function') {
    return response.statusText || 'Request failed';
  }

  const body = await response.text();
  return body || response.statusText || 'Request failed';
}

function toImageDataUrl(value: string): string {
  return value.startsWith('data:image/') ? value : `${IMAGE_DATA_URL_PREFIX}${value}`;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length > 12;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
import { redactText } from '../lib/redaction';
