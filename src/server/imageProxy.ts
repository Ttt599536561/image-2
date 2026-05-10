import {
  buildImageGenerationPayload,
  buildImageGenerationUrl,
  type ImageGenerationRequest,
} from '../api/imageGeneration';
import { redactText } from '../lib/redaction';
import { DEFAULT_API_CONFIG } from '../lib/storage';
import { validateApiConfig } from '../lib/validation';

export type ImageProxyInput = {
  baseUrl: string;
  apiKey: string;
  request: ImageGenerationRequest;
};

export type ImageProxyRequest = {
  method: string;
  body: string;
  fetchImpl?: typeof fetch;
};

export type ImageProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export async function handleImageProxyRequest({
  method,
  body,
  fetchImpl = fetch,
}: ImageProxyRequest): Promise<ImageProxyResponse> {
  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let input: ImageProxyInput;
  try {
    input = JSON.parse(body) as ImageProxyInput;
  } catch {
    return jsonResponse(400, { error: 'Malformed JSON request body' });
  }

  const configValidation = validateApiConfig({
    baseUrl: DEFAULT_API_CONFIG.baseUrl,
    apiKey: input.apiKey,
    rememberApiKey: false,
  });
  if (!configValidation.valid) {
    return jsonResponse(400, { error: configValidation.message });
  }

  try {
    const relayResponse = await fetchImpl(buildImageGenerationUrl(DEFAULT_API_CONFIG.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildImageGenerationPayload({ ...input.request, n: 1 })),
    });

    const responseText = redactText(await relayResponse.text(), [input.apiKey]);
    return {
      status: relayResponse.status,
      headers: {
        'Content-Type': relayResponse.headers.get('content-type') ?? 'application/json',
      },
      body: responseText,
    };
  } catch {
    return jsonResponse(502, {
      error: 'Proxy could not reach the relay. Check the Base URL and network connectivity.',
    });
  }
}

function jsonResponse(status: number, payload: unknown): ImageProxyResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
