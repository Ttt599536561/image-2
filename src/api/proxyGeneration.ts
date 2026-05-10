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
    throw new Error(`Proxy request failed with HTTP ${response.status}: ${details}`);
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
