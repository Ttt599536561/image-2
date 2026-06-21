import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { Check, Info, X } from "lucide-react";
import styles from "./Toast.module.css";

export type ToastVariant = "success" | "error" | "info";

export interface ToastApi {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

const AUTO_DISMISS_MS = 3000;
const EXIT_MS = 180;

const ToastContext = createContext<ToastApi | null>(null);

const variantClass: Record<ToastVariant, string> = {
  success: styles.success,
  error: styles.error,
  info: styles.info,
};

function VariantIcon({ variant }: { variant: ToastVariant }): JSX.Element {
  if (variant === "success") return <Check size={12} strokeWidth={3} aria-hidden />;
  if (variant === "error") return <X size={12} strokeWidth={3} aria-hidden />;
  return <Info size={12} strokeWidth={3} aria-hidden />;
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  // 计时器集合：组件卸载场景下由浏览器回收，留存以便手动关闭时清理。
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    // 先标记 leaving 播放退场动画，再于动画后真正移除。
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_MS);
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = idRef.current++;
      setToasts((prev) => [...prev, { id, message, variant, leaving: false }]);
      const timer = setTimeout(() => remove(id), AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, "success"),
      error: (message: string) => show(message, "error"),
      info: (message: string) => show(message, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.container} role="region" aria-live="polite" aria-label="通知">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${variantClass[t.variant]} ${
              t.leaving ? styles.leaving : ""
            }`}
            role={t.variant === "error" ? "alert" : "status"}
          >
            <span className={styles.icon}>
              <VariantIcon variant={t.variant} />
            </span>
            <span className={styles.message}>{t.message}</span>
            <button
              type="button"
              className={styles.close}
              aria-label="关闭"
              onClick={() => remove(t.id)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export default ToastProvider;
