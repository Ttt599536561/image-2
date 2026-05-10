import { type FormEvent } from 'react';
import { type GenerationRequest } from '../App';

type GeneratorFormProps = {
  request: GenerationRequest;
  isGenerating: boolean;
  onChange: (request: GenerationRequest) => void;
  onSubmit: () => void;
};

export function GeneratorForm({ request, isGenerating, onChange, onSubmit }: GeneratorFormProps) {
  function update<Key extends keyof GenerationRequest>(key: Key, value: GenerationRequest[Key]) {
    onChange({ ...request, [key]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <section aria-label="生成参数" className="generator-card">
      <div className="tabs" role="tablist" aria-label="生成模式">
        <button aria-selected="true" role="tab" type="button">
          文生图
        </button>
        <button aria-disabled="true" disabled role="tab" type="button">
          图生图
        </button>
      </div>

      <form className="generator-form" onSubmit={handleSubmit}>
          <label>
            模型
            <select onChange={(event) => update('model', event.target.value)} value={request.model}>
              <option value="gpt-image-1-mini">gpt-image-1-mini（更快推荐）</option>
              <option value="gpt-image-1.5">gpt-image-1.5</option>
              <option value="gpt-image-1">gpt-image-1</option>
              <option value="gpt-image-2">gpt-image-2（中转站自定义/实验）</option>
            </select>
          </label>

        <label>
          图片描述
          <textarea
            onChange={(event) => update('prompt', event.target.value)}
            placeholder="描述你想生成的画面"
            rows={7}
            value={request.prompt}
          />
        </label>

        <div className="form-grid">
          <label>
            尺寸
            <select onChange={(event) => update('size', event.target.value)} value={request.size}>
              <option value="1024x1024">1024x1024</option>
              <option value="1536x1024">1536x1024</option>
              <option value="1024x1536">1024x1536</option>
            </select>
          </label>

          <label>
            数量
            <input
              max={4}
              min={1}
              onChange={(event) => update('n', Number(event.target.value))}
              type="number"
              value={request.n}
            />
          </label>

          <label>
            质量
            <select onChange={(event) => update('quality', event.target.value)} value={request.quality}>
              <option value="auto">auto</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>

          <label>
            背景
            <select onChange={(event) => update('background', event.target.value)} value={request.background}>
              <option value="auto">auto</option>
              <option value="transparent">transparent</option>
              <option value="opaque">opaque</option>
            </select>
          </label>

          <label>
            审核
            <select onChange={(event) => update('moderation', event.target.value)} value={request.moderation}>
              <option value="auto">auto</option>
              <option value="low">low</option>
            </select>
          </label>

          <label>
            返回格式
            <select
              disabled
              onChange={(event) =>
                update('responseFormat', event.target.value as GenerationRequest['responseFormat'])
              }
              value={request.responseFormat}
            >
              <option value="auto">自动 (由 gpt-image-2 决定)</option>
              <option value="url">url</option>
              <option value="b64_json">b64_json</option>
            </select>
          </label>
        </div>

        <button className="primary-button" disabled={isGenerating} type="submit">
          {isGenerating ? '生成中...' : '开始创作'}
        </button>
      </form>
    </section>
  );
}
