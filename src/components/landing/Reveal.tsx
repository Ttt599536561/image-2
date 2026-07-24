import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./Reveal.module.css";

/**
 * 滚动浮现容器：进入视口时淡入上移，子元素可用 delay 错峰。
 * 尊重 prefers-reduced-motion（直接显示，不动画）。SSR 安全。
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`${styles.reveal} ${visible ? styles.visible : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
