import { Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  generateImage as generateImageRequest,
  type GenerateImageResult,
  type ImageGenerationRequest,
  type ParsedImage,
} from './api/imageGeneration';
import { ApiConfigModal } from './components/ApiConfigModal';
import { GeneratorForm } from './components/GeneratorForm';
import { ResultPanel } from './components/ResultPanel';
import { type ApiConfig, useApiConfig } from './hooks/useApiConfig';
import { createCurlPreview } from './lib/curl';
import { validateApiConfig, validateGenerationInput } from './lib/validation';

export type GenerationRequest = ImageGenerationRequest & {
  responseFormat: 'auto' | 'url' | 'b64_json';
};

export type GenerateImageFn = (input: {
  config: ApiConfig;
  request: GenerationRequest;
}) => Promise<GenerateImageResult>;

const defaultRequest: GenerationRequest = {
  model: 'gpt-image-2',
  prompt: '',
  size: '1024x1024',
  quality: 'auto',
  background: 'auto',
  moderation: 'auto',
  n: 1,
  responseFormat: 'auto',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '生成失败，请稍后重试';
}

async function defaultGenerateImage({
  config,
  request,
}: {
  config: ApiConfig;
  request: GenerationRequest;
}): Promise<GenerateImageResult> {
  return generateImageRequest({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    request: toImageGenerationRequest(request),
  });
}

type AppProps = {
  generateImage?: GenerateImageFn;
};

export default function App({ generateImage = defaultGenerateImage }: AppProps) {
  const { config, saveConfig } = useApiConfig();
  const [request, setRequest] = useState<GenerationRequest>(defaultRequest);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [images, setImages] = useState<ParsedImage[]>([]);
  const [rawResponse, setRawResponse] = useState<unknown>(null);

  const curlPreview = useMemo(
    () =>
      createCurlPreview({
        baseUrl: config.baseUrl || 'https://api.example.com/v1',
        apiKey: config.apiKey,
        request: toImageGenerationRequest(request),
      }),
    [config, request],
  );

  async function handleGenerate() {
    const prompt = request.prompt.trim();

    const generationValidation = validateGenerationInput({ prompt, quantity: request.n });
    if (!generationValidation.valid) {
      setError(generationValidation.message);
      return;
    }

    const configValidation = validateApiConfig(config);
    if (!configValidation.valid) {
      setError(configValidation.message);
      return;
    }

    setIsGenerating(true);
    setError('');
    setImages([]);
    setRawResponse(null);

    try {
      const result = await generateImage({
        config,
        request: {
          ...request,
          prompt,
        },
      });

      setImages(result.images);
      setRawResponse(result.rawResponse);
    } catch (generationError) {
      setError(getErrorMessage(generationError));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>AI 图像工坊</h1>
          <p>全网可用 · GPT Image 2 文生图</p>
        </div>
        <button className="secondary-button" onClick={() => setIsConfigOpen(true)} type="button">
          <Settings aria-hidden="true" size={18} />
          中转站 API 配置
        </button>
      </header>

      <main className="generator-layout">
        <GeneratorForm
          isGenerating={isGenerating}
          onChange={setRequest}
          onSubmit={handleGenerate}
          request={request}
        />
        <ResultPanel
          curlPreview={curlPreview}
          error={error}
          images={images}
          isGenerating={isGenerating}
          rawResponse={rawResponse}
        />
      </main>

      {isConfigOpen ? (
        <ApiConfigModal
          config={config}
          onClose={() => setIsConfigOpen(false)}
          onSave={(nextConfig) => {
            saveConfig(nextConfig);
            setIsConfigOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function toImageGenerationRequest(request: GenerationRequest): ImageGenerationRequest {
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
