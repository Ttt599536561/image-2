import { type ParsedImage } from '../api/imageGeneration';

type ResultPanelProps = {
  error: string;
  images: ParsedImage[];
  isGenerating: boolean;
  rawResponse: unknown;
};

export function ResultPanel({ error, images, isGenerating, rawResponse }: ResultPanelProps) {
  return (
    <section aria-label="生成结果" className="result-card">
      <div className="result-stage">
        {isGenerating ? <p role="status">正在生成...</p> : null}
        {!isGenerating && error ? <p className="error-message">{error}</p> : null}
        {!isGenerating && !error && images.length === 0 ? <p>开始你的创作之旅</p> : null}
        {!isGenerating && images.length > 0 ? (
          <div className="image-grid">
            {images.map((image, index) => (
              <figure key={`${image.src}-${index}`}>
                <img alt={`Generated image ${index + 1}`} src={image.src} />
                <figcaption>
                  <a download={`generated-image-${index + 1}.png`} href={image.src}>
                    下载图片 {index + 1}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </div>

      {rawResponse ? (
        <details>
          <summary>原始响应</summary>
          <pre>{JSON.stringify(rawResponse, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}
