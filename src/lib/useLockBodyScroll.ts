import { useEffect } from "react";

// 浮层/抽屉打开时锁住背景滚动（遮罩后页面不再滚）。SSR 安全：仅在 effect 内碰 document。
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [locked]);
}
