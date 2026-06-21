import { Sparkles } from 'lucide-react';
import { type FormEvent } from 'react';
import { type GenerationRequest } from '../App';

type SizeOption = {
  value: string;
  title: string;
  scene: string;
  isAuto?: boolean;
  recommended?: boolean;
  previewWidth?: number;
  previewHeight?: number;
};

// Curated, scenario-driven set. Each value already exists as a relay-supported size;
// the goal is fewer choices with clear "what is this for" guidance.
const SIZE_OPTIONS: SizeOption[] = [
  { value: 'auto', title: '智能', scene: 'AI 自动选择比例', isAuto: true, recommended: true },
  { value: '1024x1024', title: '1:1 方形', scene: '头像 · 商品 · 社交方图', previewWidth: 24, previewHeight: 24 },
  { value: '1024x1536', title: '2:3 竖图', scene: '海报 · 人像 · 杂志封面', previewWidth: 16, previewHeight: 24 },
  { value: '1536x1024', title: '3:2 横图', scene: '风景 · 横版插画', previewWidth: 24, previewHeight: 16 },
  { value: '1088x1920', title: '9:16 竖屏', scene: '手机壁纸 · 短视频', previewWidth: 14, previewHeight: 24 },
  { value: '1920x1088', title: '16:9 横屏', scene: '电脑壁纸 · 视频封面', previewWidth: 24, previewHeight: 14 },
];

type GeneratorFormProps = {
  request: GenerationRequest;
  isGenerating: boolean;
  onChange: (request: GenerationRequest) => void;
  onImageToImageClick: () => void;
  onSubmit: () => void;
};

export function GeneratorForm({
  request,
  isGenerating,
  onChange,
  onImageToImageClick,
  onSubmit,
}: GeneratorFormProps) {
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
        <button aria-disabled="true" onClick={onImageToImageClick} role="tab" type="button">
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

        <div className="size-field">
          <div className="size-field-head">
            <span className="size-field-title">尺寸</span>
            <span className="size-field-hint">按用途选择，拿不准就用「智能」</span>
          </div>
          <div aria-label="图片尺寸" className="size-options" role="radiogroup">
            {SIZE_OPTIONS.map((option) => {
              const selected = request.size === option.value;
              return (
                <label
                  className={`size-option${option.isAuto ? ' size-option--auto' : ''}${selected ? ' is-selected' : ''}`}
                  key={option.value}
                >
                  <input
                    checked={selected}
                    className="size-option-input"
                    name="size"
                    onChange={() => update('size', option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span aria-hidden="true" className="size-preview">
                    {option.isAuto ? (
                      <Sparkles size={18} />
                    ) : (
                      <span
                        className="size-preview-box"
                        style={{ width: `${option.previewWidth}px`, height: `${option.previewHeight}px` }}
                      />
                    )}
                  </span>
                  <span className="size-option-body">
                    <span className="size-option-title">
                      {option.title}
                      {option.recommended ? <span className="size-badge">推荐</span> : null}
                    </span>
                    <span className="size-option-scene">{option.scene}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-grid">
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
              <option value="auto">自动审核</option>
              <option value="low">宽松审核</option>
            </select>
            <span className="field-hint">宽松审核会降低过滤强度，适合普通创作失败时再尝试。</span>
          </label>
        </div>

        <button className="primary-button" disabled={isGenerating} type="submit">
          {isGenerating ? '生成中...' : '开始创作'}
        </button>
      </form>
    </section>
  );
}
