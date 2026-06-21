import {
  ImageGenerationRequest,
  buildImageGenerationPayload,
  buildImageGenerationUrl,
} from '../api/imageGeneration';

export type CurlPreviewOptions = {
  baseUrl: string;
  apiKey: string;
  request: ImageGenerationRequest;
};

const REDACTED_API_KEY = 'sk-***';

export function createCurlPreview({
  baseUrl,
  request,
}: CurlPreviewOptions): string {
  const url = buildImageGenerationUrl(baseUrl);
  const payload = JSON.stringify(buildImageGenerationPayload(request), null, 2);

  return [
    `curl -X POST "${url}" \\`,
    `  -H "Authorization: Bearer ${REDACTED_API_KEY}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '${payload}'`,
  ].join('\n');
}
