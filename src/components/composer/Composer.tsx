import {
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Crop,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Background, CredentialMode, GenerateParams, Quality } from "../../contracts/generate";
import { UPLOAD_ACCEPT } from "../../contracts/upload";
import { PRICE_PER_IMAGE_MP } from "../../lib/credits";
import { formatCredits } from "../../lib/format";
import { usePopover } from "../../lib/usePopover";
import {
  BACKGROUND_OPTIONS,
  QUALITY_OPTIONS,
  SIZE_OPTIONS,
  sizeLabel,
} from "./sizeOptions";
import styles from "./Composer.module.css";

export interface ComposerProps {
  request: GenerateParams;
  onChange: (req: GenerateParams) => void;
  onSubmit: () => void;
  disabled?: boolean;
  canAfford: boolean;
  balanceMp: number;
  credentialMode: CredentialMode;
  customEnabled: boolean;
  // 单图价（毫积分）；父级从 /api/me 实时取，缺省回退常量（首帧/无数据兜底）。
  pricePerImageMp?: number;
  variant?: "full" | "compact";
  textareaRef?: Ref<HTMLTextAreaElement>;
  // ④b 图生图：参考图（受控于父级；父级负责校验类型/大小并 toast）。null = 文生图。
  inputImageFile?: File | null;
  onPickInputImage?: (file: File | null) => void;
}

export function Composer({
  request,
  onChange,
  onSubmit,
  disabled = false,
  canAfford,
  balanceMp,
  credentialMode,
  customEnabled,
  pricePerImageMp = PRICE_PER_IMAGE_MP,
  variant = "full",
  textareaRef,
  inputImageFile = null,
  onPickInputImage,
}: ComposerProps) {
  const sizePop = usePopover();
  const advPop = usePopover();
  const navigate = useNavigate();
  const popoverDir = variant === "compact" ? styles.popoverUp : "";

  // ④b：参考图启用与否取决于父级是否接了回调（接了=图生图可用）。
  const i2iEnabled = typeof onPickInputImage === "function";
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 缩略图预览：为 File 造 object URL，换图/卸载时回收。
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inputImageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(inputImageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [inputImageFile]);

  const openPicker = () => fileInputRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ""; // 允许重选同一文件再次触发 change
    if (f) onPickInputImage?.(f);
  };
  const removeImage = () => onPickInputImage?.(null);

  // 合并 ref：本地 ref 做自适应高度，同时把 node 透传给父级（聚焦/滚动）。
  const localRef = useRef<HTMLTextAreaElement>(null);
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (typeof textareaRef === "function") textareaRef(node);
      else if (textareaRef)
        (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
    },
    [textareaRef],
  );

  // 自适应高度（随受控值变化，覆盖用户输入与程序回填/清空），上限 200px 后滚动。
  useEffect(() => {
    const ta = localRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [request.prompt, variant]);

  const set = <K extends keyof GenerateParams>(key: K, value: GenerateParams[K]) =>
    onChange({ ...request, [key]: value });

  const canSend = !disabled && request.prompt.trim().length > 0;
  const modeCanGenerate = credentialMode === "custom" ? customEnabled : canAfford;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!canSend) return;
      if (modeCanGenerate) onSubmit();
      else if (credentialMode === "system") navigate("/billing");
    }
  };

  const placeholder = inputImageFile
    ? "描述你想如何修改这张图…（如：换成赛博朋克风格、把背景改成海边）"
    : variant === "full"
      ? "描述你想生成的画面…"
      : "继续在当前对话生图…";

  return (
    <div className={styles.composer}>
      {i2iEnabled ? (
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_ACCEPT.join(",")}
          hidden
          disabled={disabled}
          onChange={onFileChange}
        />
      ) : null}

      {inputImageFile && previewUrl ? (
        <div className={styles.refRow}>
          <div className={styles.refThumbWrap}>
            <img className={styles.refThumb} src={previewUrl} alt="参考图" />
            <button
              type="button"
              className={styles.refRemove}
              onClick={removeImage}
              disabled={disabled}
              aria-label="移除参考图"
              title="移除参考图"
            >
              <X size={12} />
            </button>
          </div>
          <span className={styles.refChip}>
            <ImagePlus size={13} />
            图生图模式 · 基于参考图生成
          </span>
        </div>
      ) : null}

      <textarea
        ref={setRefs}
        className={`${styles.textarea} ${variant === "full" ? styles.textareaFull : ""}`}
        placeholder={placeholder}
        value={request.prompt}
        onChange={(e) => set("prompt", e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={variant === "full" ? 3 : 1}
      />

      <div className={styles.controls}>
        <div className={styles.left}>
          {i2iEnabled ? (
            <button
              type="button"
              className={`${styles.pill} ${inputImageFile ? styles.pillActive : ""}`}
              onClick={openPicker}
              disabled={disabled}
              title={inputImageFile ? "更换参考图" : "上传参考图（图生图）"}
            >
              <ImagePlus size={15} />
              {inputImageFile ? "已选参考图" : "参考图"}
            </button>
          ) : (
            <span className={`${styles.pill} ${styles.pillDisabled}`} title="参考图（敬请期待）">
              <ImagePlus size={15} />
            </span>
          )}

          <div className={styles.pillWrap} ref={sizePop.ref}>
            <button
              type="button"
              className={`${styles.pill} ${sizePop.open ? styles.pillActive : ""}`}
              onClick={() => sizePop.setOpen((o) => !o)}
              disabled={disabled}
            >
              <Crop size={15} />
              比例 · {sizeLabel(request.size)}
              <ChevronDown size={13} />
            </button>
            {sizePop.open ? (
              <div className={`${styles.popover} ${styles.popoverSize} ${popoverDir}`}>
                <p className={styles.popoverTitle}>选择比例</p>
                <div className={styles.sizeGrid}>
                  {SIZE_OPTIONS.map((opt) => {
                    const active = request.size === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`${styles.sizeCard} ${active ? styles.sizeCardActive : ""}`}
                        disabled={disabled}
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
              disabled={disabled}
            >
              <SlidersHorizontal size={15} />
              高级设置
              <ChevronDown
                size={13}
                style={{
                  transform: advPop.open ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </button>
            {advPop.open ? (
              <div className={`${styles.popover} ${styles.popoverAdv} ${popoverDir}`}>
                <p className={styles.popoverTitle}>高级设置</p>
                <div className={styles.advField}>
                  <span className={styles.advLabel}>质量</span>
                  <div className={styles.segment}>
                    {QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q.value}
                        type="button"
                        className={`${styles.segBtn} ${(request.quality ?? "auto") === q.value ? styles.segBtnActive : ""}`}
                        disabled={disabled}
                        onClick={() => {
                          set("quality", q.value as Quality);
                          advPop.setOpen(false);
                        }}
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
                        disabled={disabled}
                        onClick={() => {
                          set("background", b.value as Background);
                          advPop.setOpen(false);
                        }}
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
          {credentialMode === "custom" ? (
            <span className={styles.costHint}>
              {customEnabled ? "使用自定义 Key · 本站不扣积分" : "自定义 Key 暂停使用"}
            </span>
          ) : canAfford ? (
            <span className={styles.costHint}>
              本次消耗 <span className={styles.costStrong}>{formatCredits(pricePerImageMp)}</span>{" "}
              积分 / 剩余 {formatCredits(balanceMp)} 积分
            </span>
          ) : null}
          {credentialMode === "custom" || canAfford ? (
            <button
              type="button"
              className={styles.send}
              onClick={onSubmit}
              disabled={!canSend || !modeCanGenerate}
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
