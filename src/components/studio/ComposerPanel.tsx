import { ArrowUpRight, ChevronDown, Circle, Sparkles, WandSparkles } from "lucide-react";
import type { StudioParams } from "../../contracts/studio";
import type { Background, Quality } from "../../contracts/generate";
import { BACKGROUND_OPTIONS, QUALITY_OPTIONS, SIZE_OPTIONS } from "../composer/sizeOptions";
import { ReferenceImage } from "./ReferenceImage";
import styles from "./Studio.module.css";

type Props = {
  params: StudioParams; onParams: (params: StudioParams) => void;
  reference: File | null; onReference: (file: File | null) => void;
  onGenerate: () => void; busy: boolean; enabled: boolean; hasConnection: boolean;
  connectionLabel: string; onConnection: () => void;
};
export function ComposerPanel(props: Props) {
  const { params, onParams, reference, onReference, busy, enabled, hasConnection } = props;
  const submit = () => { if (!busy && enabled && params.prompt.trim()) hasConnection ? props.onGenerate() : props.onConnection(); };
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}
    onPaste={(event) => {
      const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
      if (image) { event.preventDefault(); onReference(image); }
    }} onKeyDown={(event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit(); }
    }}>
    <div className={styles.panelScroll}>
      <div className={styles.panelHeading}><div><span className={styles.eyebrow}>IMAGE STUDIO</span><h1>让想法成像</h1></div><WandSparkles size={21} className={styles.accentIcon} strokeWidth={1.4} /></div>
      <button type="button" className={styles.connectionSummary} onClick={props.onConnection}>
        <Circle size={7} fill="currentColor" className={hasConnection ? styles.connected : styles.disconnected} />
        <span><strong>{hasConnection ? "当前连接" : "连接你的图片服务"}</strong><small>{props.connectionLabel}</small></span>
        <ArrowUpRight size={15} aria-hidden />
      </button>
      <div className={styles.promptField}>
        <div className={styles.fieldHeading}><label htmlFor="studio-prompt">画面描述</label><span className={styles.optional}>PROMPT</span></div>
        <textarea id="studio-prompt" value={params.prompt} maxLength={4000} rows={6} placeholder="描述你想看见的画面。试着加入主体、场景、光线和风格…" onChange={(event) => onParams({ ...params, prompt: event.target.value })} />
        <div className={styles.promptFooter}><span>细节越具体，画面越接近想象</span><span>{params.prompt.length}<span> / 4000</span></span></div>
      </div>
      <ReferenceImage file={reference} onChange={onReference} />
      <fieldset className={styles.sizes}><legend>画面比例 <span className={styles.optional}>输出尺寸</span></legend>
        <div className={styles.sizeGrid}>{SIZE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={params.size === option.value} className={`${styles.sizeCard} ${params.size === option.value ? styles.sizeSelected : ""}`} onClick={() => onParams({ ...params, size: option.value })}>
          <span className={styles.ratioIcon}>{option.isAuto ? <Sparkles size={19} strokeWidth={1.4} /> : <i style={{ width: option.previewWidth, height: option.previewHeight }} />}</span>
          <strong>{option.isAuto ? "自动" : option.title.split(" ")[0]}</strong>
          <small>{option.isAuto ? "智能选择" : option.value.replace("x", " × ")}</small>
        </button>)}</div>
      </fieldset>
      <div className={styles.selectRow}><label htmlFor="studio-quality">生成质量</label><select id="studio-quality" value={params.quality ?? "auto"} onChange={(event) => onParams({ ...params, quality: event.target.value as Quality })}>{QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <details className={styles.advanced}><summary>更多选项<ChevronDown size={15} /></summary><div className={styles.selectRow}><label htmlFor="studio-background">图片背景</label><select id="studio-background" value={params.background ?? "auto"} onChange={(event) => onParams({ ...params, background: event.target.value as Background })}>{BACKGROUND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></details>
    </div>
    <div className={styles.composerFooter}>
      <button type="submit" className={styles.generateButton} disabled={busy || !enabled || !params.prompt.trim()}><Sparkles size={17} />{busy ? "正在提交…" : hasConnection ? "开始生成" : "连接服务后开始"}<span>↵</span></button>
      <p>Ctrl / ⌘ + Enter 生成 <span>·</span> Enter 换行</p>
    </div>
  </form>;
}
