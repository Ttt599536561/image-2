import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { Size } from "../../contracts/generate";
import { formatTimer } from "../../lib/format";
import { aspectRatioFor } from "./sizeOptions";
import styles from "./CosmicSkeleton.module.css";

export interface CosmicSkeletonProps {
  /** 选定尺寸，决定占位格宽高比（auto→1:1）。 */
  size: Size;
  /** 生成开始时刻（Date.now() 毫秒），用于计算已用时长。 */
  startedAt: number;
  className?: string;
}

/**
 * 宇宙星空"生成中"占位（design-system §8）。多层深空银河 + 离散闪烁星点 +
 * 掠星事件 + 角落呼吸光 + 底部暗角；居中标签每秒跳动显示 "生成中 M:SS"。
 * SSR 安全：计时 state 由 Date.now()-startedAt 初始化，仅在 useEffect 内启动 1s interval。
 * 仅动画 transform/opacity；prefers-reduced-motion 下冻结为静态深空。
 */
export function CosmicSkeleton({ size, startedAt, className }: CosmicSkeletonProps): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState<number>(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick(); // 挂载即对齐一次（修正水合后的首帧偏差）
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const tileClass = className ? `${styles.tile} ${className}` : styles.tile;
  const timer = formatTimer(elapsedMs);

  return (
    <div
      className={tileClass}
      style={{ aspectRatio: String(aspectRatioFor(size)) }}
      role="img"
      aria-label={`生成中 ${timer}`}
    >
      <div className={styles.galaxy} />
      <div className={styles.neb} />
      <div className={styles.stars} />
      <div className={styles.stars2} />
      <div className={styles.stars3} />
      <div className={styles.sweep} />
      <div className={styles.comet} />
      <div className={styles.meta} aria-hidden="true">
        <span className={styles.dot} />
        生成中 <b>{timer}</b>
      </div>
    </div>
  );
}

export default CosmicSkeleton;
