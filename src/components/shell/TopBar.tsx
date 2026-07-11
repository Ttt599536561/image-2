import { Coins, KeyRound, LayoutGrid, Menu, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useMe } from "../../hooks/queries";
import { useUserApiConfig } from "../../hooks/useUserApiConfig";
import { formatCredits, formatMonthDay } from "../../lib/format";
import { useThemeMode } from "../../lib/theme";
import { NotificationBell } from "./NotificationBell";
import { ApiKeyModal } from "./ApiKeyModal";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  title?: string;
  currentLabel?: string; // 「（当前对话）」之类的灰字后缀
  thisCount?: number; // 本次·N（仅对话路由传）
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  onOpenMenu?: () => void;
  onOpenKeySettings?: () => void;
}

export function TopBar({
  title,
  currentLabel,
  thisCount,
  panelOpen,
  onTogglePanel,
  onOpenMenu,
  onOpenKeySettings,
}: TopBarProps) {
  const me = useMe();
  const { theme, toggle } = useThemeMode();
  const [keySettingsOpen, setKeySettingsOpen] = useState(false);
  const userId = me.data?.user.id;
  const customEnabled = me.data?.customKeyModesEnabled === true;
  const userApiConfig = useUserApiConfig(userId);

  const keyState =
    userApiConfig.config.mode === "custom"
      ? customEnabled
        ? "当前自定义 Key"
        : "自定义 Key 已暂停"
      : "当前系统 Key";
  const keyTitle = `生图 Key 设置：${keyState}`;
  const openKeySettings = () => {
    if (onOpenKeySettings) onOpenKeySettings();
    else setKeySettingsOpen(true);
  };

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

        <Link to="/billing" prefetch="intent" className={styles.pill} title={expTip}>
          <Coins size={15} className={styles.coin} />
          {formatCredits(balanceMp)} 积分
          {expMp > 0 ? <span className={styles.warnDot} aria-hidden="true" /> : null}
        </Link>

        <button
          type="button"
          className={`${styles.iconBtn} ${userApiConfig.config.mode === "custom" ? styles.keyCustom : ""}`}
          onClick={openKeySettings}
          disabled={!userApiConfig.ready}
          aria-label={keyTitle}
          title={keyTitle}
        >
          <KeyRound size={17} />
        </button>

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
      {keySettingsOpen && userId ? (
        <ApiKeyModal
          userId={userId}
          customEnabled={customEnabled}
          onClose={() => setKeySettingsOpen(false)}
        />
      ) : null}
    </header>
  );
}
