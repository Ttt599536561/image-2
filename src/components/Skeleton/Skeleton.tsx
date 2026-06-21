import type { CSSProperties, JSX } from "react";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
}

function toCssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({
  width,
  height,
  radius,
  circle = false,
  className,
}: SkeletonProps): JSX.Element {
  const style: CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    // circle 由 .circle 类负责 50%；否则用入参或默认 --radius-md。
    borderRadius: circle ? undefined : (toCssSize(radius) ?? "var(--radius-md)"),
  };

  const classes = [styles.skeleton, circle ? styles.circle : "", className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes} style={style} aria-hidden />;
}

export default Skeleton;
