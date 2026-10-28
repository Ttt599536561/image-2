import { ArrowUpRight, Circle, LoaderCircle, Sparkles, WandSparkles } from "lucide-react";
import { STUDIO_MODEL, STUDIO_MODELS, type StudioParams } from "../../contracts/studio";
import { BACKGROUND_OPTIONS, QUALITY_OPTIONS, SIZE_OPTIONS } from "../composer/sizeOptions";
import { ReferenceImage } from "./ReferenceImage";
import { StudioSelect } from "./StudioSelect";
import styles from "./Studio.module.css";

type Props = {
  params: StudioParams; onParams: (params: StudioParams) => void;
  references: File[]; onReferences: (files: File[]) => void; onRemoveReference: (index: number) => void;
  onGenerate: () => void; busy: boolean; enabled: boolean; hasConnection: boolean;
  connectionLabel: string; onConnection: () => void;
};
export function ComposerPanel(props: Props) {
  const { params, onParams, references, onReferences, busy, enabled, hasConnection } = props;
  const submit = () => { if (!busy && enabled && params.prompt.trim()) hasConnection ? props.onGenerate() : props.onConnection(); };
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}
    onPaste={(event) => {
      const files = [...event.clipboardData.files];
      if (files.length) { event.preventDefault(); onReferences(files); }
    }} onKeyDown={(event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
    }}>
    <div className={styles.panelScroll}>
      <div className={styles.panelHeading}><div><span className={styles.eyebrow}>IMAGE STUDIO</span><h1>让想法成像</h1></div><WandSparkles size={21} className={styles.accentIcon} strokeWidth={1.4} />
      <button type="button" className={styles.connectionSummary} onClick={props.onConnection}>
        <Circle size={7} fill="currentColor" className={hasConnection ? styles.connected : styles.disconnected} />
        <span><strong>{hasConnection ? "Key 已配置" : "配置 API Key"}</strong><small>{props.connectionLabel}</small></span>
        <ArrowUpRight size={15} aria-hidden />
      </button>
      </div>
      <StudioSelect label="生成模型" value={params.model ?? STUDIO_MODEL} options={STUDIO_MODELS.map((value) => ({ value, label: value }))} onChange={(model) => onParams({ ...params, model })} />
      <div className={styles.promptField}>
        <div className={styles.fieldHeading}><label htmlFor="studio-prompt">画面描述</label><span className={styles.optional}>PROMPT</span></div>
        <textarea id="studio-prompt" value={params.prompt} maxLength={4000} rows={4} placeholder="描述主体、场景、光线与风格，让画面更接近你的想象…" onChange={(event) => onParams({ ...params, prompt: event.target.value })} />
        <div className={styles.promptFooter}><span>细节越具体，画面越接近想象</span><span>{params.prompt.length}<span> / 4000</span></span></div>
      </div>
      <ReferenceImage files={references} onAdd={onReferences} onRemove={props.onRemoveReference} />
      <fieldset className={styles.sizes}><legend>画面比例 <span className={styles.optional}>输出尺寸</span></legend>
        <div className={styles.sizeGrid}>{SIZE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={params.size === option.value} className={`${styles.sizeCard} ${params.size === option.value ? styles.sizeSelected : ""}`} onClick={() => onParams({ ...params, size: option.value })}>
          <span className={styles.ratioIcon}>{option.isAuto ? <Sparkles size={19} strokeWidth={1.4} /> : <i style={{ width: option.previewWidth, height: option.previewHeight }} />}</span>
          <span className={styles.sizeText}><strong>{option.isAuto ? "自动" : option.title.split(" ")[0]}</strong>
          <small>{option.isAuto ? "智能选择" : option.value.replace("x", " × ")}</small></span>
        </button>)}</div>
      </fieldset>
      <div className={styles.optionsGrid}>
        <StudioSelect label="生成质量" value={params.quality ?? "auto"} options={QUALITY_OPTIONS} onChange={(quality) => onParams({ ...params, quality })} />
        <StudioSelect label="图片背景" value={params.background ?? "auto"} options={BACKGROUND_OPTIONS} onChange={(background) => onParams({ ...params, background })} />
      </div>
    </div>
    <div className={styles.composerFooter}>
      <button type="submit" className={styles.generateButton} aria-busy={busy} disabled={busy || !enabled || !params.prompt.trim()}>{busy ? <LoaderCircle size={17} className={styles.spinner} /> : <Sparkles size={17} />}{busy ? "正在处理…" : hasConnection ? "开始生成" : "连接服务后开始"}<span>↵</span></button>
      <p>Ctrl / ⌘ + Enter 生成 <span>·</span> Enter 换行</p>
    </div>
  </form>;
}
