import { useState } from 'react';
import { type GenerateImageResult, type ImageGenerationRequest, type ParsedImage } from './api/imageGeneration';
import { generateImageViaProxy } from './api/proxyGeneration';
import { GeneratorForm } from './components/GeneratorForm';
import { ResultPanel } from './components/ResultPanel';
import { redactSecrets, redactText } from './lib/redaction';
import { DEFAULT_IMAGE_MODEL, loadSelectedImageModel, saveSelectedImageModel } from './lib/storage';
import { validateGenerationInput } from './lib/validation';

export type GenerationRequest = ImageGenerationRequest & {
  responseFormat: 'auto' | 'url' | 'b64_json';
};

export type GenerateImageFn = (input: {
  request: GenerationRequest;
}) => Promise<GenerateImageResult>;

const defaultRequest: GenerationRequest = {
  model: DEFAULT_IMAGE_MODEL,
  prompt: '',
  size: 'auto',
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
  request,
}: {
  request: GenerationRequest;
}): Promise<GenerateImageResult> {
  // 铁律④：前端不再持有任何 Key/baseUrl，只发 request，Key 由服务端 env 注入。
  return generateImageViaProxy({
    request: toImageGenerationRequest(request),
  });
}

type AppProps = {
  generateImage?: GenerateImageFn;
};

export default function App({ generateImage = defaultGenerateImage }: AppProps) {
  const [request, setRequest] = useState<GenerationRequest>(() => ({
    ...defaultRequest,
    model: loadSelectedImageModel(),
  }));
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [images, setImages] = useState<ParsedImage[]>([]);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [toastMessage, setToastMessage] = useState('');

  function handleImageToImageClick() {
    setToastMessage('图生图功能正在开发中');
  }

  function handleRequestChange(nextRequest: GenerationRequest) {
    if (nextRequest.model !== request.model) {
      saveSelectedImageModel(nextRequest.model);
    }

    setRequest(nextRequest);
  }

  async function handleGenerate() {
    const prompt = request.prompt.trim();

    const generationValidation = validateGenerationInput({ prompt, quantity: request.n });
    if (!generationValidation.valid) {
      setError(generationValidation.message);
      return;
    }

    setIsGenerating(true);
    setToastMessage('');
    setError('');
    setImages([]);
    setRawResponse(null);

    try {
      const result = await generateImage({
        request: {
          ...request,
          prompt,
        },
      });

      setImages(result.images);
      // 服务端已脱敏；前端无 key 可脱敏，仍兜底过一遍通用模式。
      setRawResponse(redactSecrets(result.rawResponse, []));
    } catch (generationError) {
      setError(redactText(getErrorMessage(generationError), []));
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
      </header>

      <main className="generator-layout">
        <GeneratorForm
          isGenerating={isGenerating}
          onChange={handleRequestChange}
          onImageToImageClick={handleImageToImageClick}
          onSubmit={handleGenerate}
          request={request}
        />
        <ResultPanel
          error={error}
          images={images}
          isGenerating={isGenerating}
          rawResponse={rawResponse}
        />
      </main>

      {toastMessage ? (
        <div className="toast" role="status">
          {toastMessage}
        </div>
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
    n: 1,
  };
}
