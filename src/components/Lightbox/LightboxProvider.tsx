import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { Copy, Download, X } from "lucide-react";
import { copyImageToClipboard, downloadImage } from "../../lib/download";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Lightbox.module.css";

export interface LightboxOptions {
  /** 浮在放大图上的说明层（如灵感卡的标题/摘要/用此提示词，#1 高级视觉）。 */
  caption?: ReactNode;
  /** 是否显示下载/复制操作（默认 true；灵感卡传 false 只看图+悬浮文字）。 */
  showActions?: boolean;
}

export interface LightboxApi {
  open: (src: string, filename?: string, options?: LightboxOptions) => void;
  close: () => void;
}

interface LightboxState {
  src: string;
  filename: string;
  caption?: ReactNode;
  showActions: boolean;
}

const LightboxContext = createContext<LightboxApi | null>(null);

export function LightboxProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<LightboxState | null>(null);
  // 仅客户端挂载后渲染浮层，避免 SSR 触碰 document。
  const [mounted, setMounted] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setMounted(true);
  }, []);

  const open = useCallback((src: string, filename?: string, options?: LightboxOptions) => {
    setState({
      src,
      filename: filename ?? "image.png",
      caption: options?.caption,
      showActions: options?.showActions ?? true,
    });
  }, []);

  const close = useCallback(() => {
    setState(null);
  }, []);

  const api = useMemo<LightboxApi>(() => ({ open, close }), [open, close]);
  const closeRef = useRef<HTMLButtonElement>(null);

  // ESC 关闭（仅打开时绑定）。
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, close]);

  const isOpen = mounted && state !== null;

  // 打开时锁背景滚动 + 把初始焦点移到关闭键（键盘可达）。
  useLockBodyScroll(isOpen);
  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  const copyImage = (src: string) => {
    copyImageToClipboard(src).then(
      () => toast.success("图片已复制到剪贴板"),
      () => toast.error("复制图片失败，请改用下载"),
    );
  };

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {isOpen ? (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="图片放大预览"
          onClick={close}
        >
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          >
            <X size={18} aria-hidden />
          </button>

          <figure className={styles.figure} onClick={(e) => e.stopPropagation()}>
            <img className={styles.image} src={state.src} alt="" />
            {state.caption ? <div className={styles.caption}>{state.caption}</div> : null}
          </figure>

          {state.showActions ? (
            <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
              {/* #17：真下载（fetch blob，跨域直链 download 属性会被忽略） */}
              <button
                type="button"
                className={styles.action}
                onClick={() => downloadImage(state.src, state.filename)}
              >
                <Download size={15} aria-hidden />
                下载
              </button>
              <button type="button" className={styles.action} onClick={() => copyImage(state.src)}>
                <Copy size={15} aria-hidden />
                复制
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </LightboxContext.Provider>
  );
}

export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext);
  if (!ctx) {
    throw new Error("useLightbox must be used within a LightboxProvider");
  }
  return ctx;
}

export default LightboxProvider;
