import { Coins, LayoutGrid, Menu, Moon, Sun } from "lucide-react";
import { Link } from "react-router";
import { useMe } from "../../hooks/queries";
import { formatCredits, formatMonthDay } from "../../lib/format";
import { useThemeMode } from "../../lib/theme";
import { NotificationBell } from "./NotificationBell";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  title?: string;
  currentLabel?: string; // 「（当前对话）」之类的灰字后缀
  thisCount?: number; // 本次·N（仅对话路由传）
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  onOpenMenu?: () => void;
}

export function TopBar({
  title,
  currentLabel,
  thisCount,
  panelOpen,
  onTogglePanel,
  onOpenMenu,
}: TopBarProps) {
  const me = useMe();
  const { theme, toggle } = useThemeMode();

  const balanceMp = me.data?.balanceMp ?? 0;
  const expiringSoon = me.data?.expiringSoon;
  const expMp = Number(expiringSoon?.mp || "0");
  const expTip =
    expMp > 0 && expiringSoon?.nearestExpiresAt
      ? `${formatCredits(expMp)} 积分将于 ${formatMonthDay(expiringSoon.nearestExpiresAt)} 过期`
      : undefined;

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.menuBtn}`}
          onClick={onOpenMenu}
          aria-label="打开菜单"
        >
          <Menu size={18} />
        </button>
        {title ? (
          <h1 className={styles.title}>
            {title}
            {currentLabel ? <span className={styles.titleMuted}>{currentLabel}</span> : null}
          </h1>
        ) : null}
      </div>

      <div className={styles.right}>
        {onTogglePanel ? (
          <button
            type="button"
            className={`${styles.panelToggle} ${panelOpen ? styles.panelToggleActive : ""}`}
            onClick={onTogglePanel}
            title="本次对话图片"
          >
            <LayoutGrid size={15} />
            <span className={styles.panelLabelFull}>本次·</span>
            {thisCount ?? 0}
          </button>
        ) : null}

        <Link to="/billing" className={styles.pill} title={expTip}>
          <Coins size={15} className={styles.coin} />
          {formatCredits(balanceMp)} 积分
          {expMp > 0 ? <span className={styles.warnDot} aria-hidden="true" /> : null}
        </Link>

        <NotificationBell buttonClassName={styles.iconBtn} />

        <button
          type="button"
          className={styles.iconBtn}
          onClick={toggle}
          aria-label={theme === "light" ? "切换深色" : "切换浅色"}
        >
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </div>
    </header>
  );
}
