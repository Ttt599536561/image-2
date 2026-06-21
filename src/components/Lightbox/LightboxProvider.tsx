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
import { Download, X } from "lucide-react";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import styles from "./Lightbox.module.css";

export interface LightboxApi {
  open: (src: string, filename?: string) => void;
  close: () => void;
}

interface LightboxState {
  src: string;
  filename: string;
}

const LightboxContext = createContext<LightboxApi | null>(null);

export function LightboxProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<LightboxState | null>(null);
  // 仅客户端挂载后渲染浮层，避免 SSR 触碰 document。
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const open = useCallback((src: string, filename?: string) => {
    setState({ src, filename: filename ?? "image.png" });
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

          <img
            className={styles.image}
            src={state.src}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />

          <a
            className={styles.download}
            href={state.src}
            download={state.filename}
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={15} aria-hidden />
            下载
          </a>
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
