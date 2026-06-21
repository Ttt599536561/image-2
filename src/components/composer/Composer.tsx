import {
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Crop,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { Ref } from "react";
import { Link } from "react-router";
import type { Background, GenerateRequest, Quality } from "../../contracts/generate";
import { formatCredits } from "../../lib/format";
import { usePopover } from "../../lib/usePopover";
import { PRICE_PER_IMAGE_MP } from "../../mocks/api";
import {
  BACKGROUND_OPTIONS,
  QUALITY_OPTIONS,
  SIZE_OPTIONS,
  sizeLabel,
} from "./sizeOptions";
import styles from "./Composer.module.css";

export interface ComposerProps {
  request: GenerateRequest;
  onChange: (req: GenerateRequest) => void;
  onSubmit: () => void;
  disabled?: boolean;
  canAfford: boolean;
  balanceMp: number;
  variant?: "full" | "compact";
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function Composer({
  request,
  onChange,
  onSubmit,
  disabled = false,
  canAfford,
  balanceMp,
  variant = "full",
  textareaRef,
}: ComposerProps) {
  const sizePop = usePopover();
  const advPop = usePopover();

  const set = <K extends keyof GenerateRequest>(key: K, value: GenerateRequest[K]) =>
    onChange({ ...request, [key]: value });

  const canSend = !disabled && request.prompt.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend && canAfford) onSubmit();
    }
  };

  return (
    <div className={styles.composer}>
      <textarea
        ref={textareaRef}
        className={`${styles.textarea} ${variant === "full" ? styles.textareaFull : ""}`}
        placeholder={variant === "full" ? "描述你想生成的画面…" : "继续在当前对话生图…"}
        value={request.prompt}
        onChange={(e) => set("prompt", e.target.value)}
        onKeyDown={handleKeyDown}
        rows={variant === "full" ? 3 : 1}
      />

      <div className={styles.controls}>
        <div className={styles.left}>
          <span className={`${styles.pill} ${styles.pillDisabled}`} title="参考图（敬请期待）">
            <ImagePlus size={15} />
          </span>

          <div className={styles.pillWrap} ref={sizePop.ref}>
            <button
              type="button"
              className={`${styles.pill} ${sizePop.open ? styles.pillActive : ""}`}
              onClick={() => sizePop.setOpen((o) => !o)}
            >
              <Crop size={15} />
              比例 · {sizeLabel(request.size)}
              <ChevronDown size={13} />
            </button>
            {sizePop.open ? (
              <div className={`${styles.popover} ${styles.popoverSize}`}>
                <p className={styles.popoverTitle}>选择比例</p>
                <div className={styles.sizeGrid}>
                  {SIZE_OPTIONS.map((opt) => {
                    const active = request.size === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`${styles.sizeCard} ${active ? styles.sizeCardActive : ""}`}
                        onClick={() => {
                          set("size", opt.value);
                          sizePop.setOpen(false);
                        }}
                      >
                        <span className={styles.sizePreview}>
                          {opt.isAuto ? (
                            <Sparkles size={16} />
                          ) : (
                            <span
                              className={styles.sizePreviewBox}
                              style={{ width: opt.previewWidth, height: opt.previewHeight }}
                            />
                          )}
                        </span>
                        <span className={styles.sizeMeta}>
                          <span className={styles.sizeTitle}>{opt.title}</span>
                          <span className={styles.sizeScene}>{opt.scene}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles.pillWrap} ref={advPop.ref}>
            <button
              type="button"
              className={`${styles.pill} ${advPop.open ? styles.pillActive : ""}`}
              onClick={() => advPop.setOpen((o) => !o)}
            >
              <SlidersHorizontal size={15} />
              高级设置
            </button>
            {advPop.open ? (
              <div className={`${styles.popover} ${styles.popoverAdv}`}>
                <p className={styles.popoverTitle}>高级设置</p>
                <div className={styles.advField}>
                  <span className={styles.advLabel}>质量</span>
                  <div className={styles.segment}>
                    {QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q.value}
                        type="button"
                        className={`${styles.segBtn} ${(request.quality ?? "auto") === q.value ? styles.segBtnActive : ""}`}
                        onClick={() => set("quality", q.value as Quality)}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.advField}>
                  <span className={styles.advLabel}>背景</span>
                  <div className={styles.segment}>
                    {BACKGROUND_OPTIONS.map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        className={`${styles.segBtn} ${(request.background ?? "auto") === b.value ? styles.segBtnActive : ""}`}
                        onClick={() => set("background", b.value as Background)}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className={styles.advNote}>审核已固定为「宽松」，不在此显示</p>
              </div>
            ) : null}
          </div>

          <span className={`${styles.pill} ${styles.pillDashed}`} title="优化提示词（敬请期待）">
            <Wand2 size={15} />
            优化提示词
          </span>
        </div>

        <div className={styles.right}>
          {canAfford ? (
            <span className={styles.costHint}>
              本次消耗 <span className={styles.costStrong}>{formatCredits(PRICE_PER_IMAGE_MP)}</span>{" "}
              积分 / 剩余 {formatCredits(balanceMp)} 积分
            </span>
          ) : null}
          {canAfford ? (
            <button
              type="button"
              className={styles.send}
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="生成"
            >
              <ArrowUp size={18} />
            </button>
          ) : (
            <Link to="/billing" className={styles.insufficient}>
              积分不足，去充值
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
