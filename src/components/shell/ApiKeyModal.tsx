import { Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CredentialMode } from "../../contracts/generate";
import { useUserApiConfig } from "../../hooks/useUserApiConfig";
import { CUSTOM_RELAY_BASE_URL } from "../../lib/userApiConfig";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import styles from "./ApiKeyModal.module.css";

export interface ApiKeyModalProps {
  userId: string;
  customEnabled: boolean;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function ApiKeyModal({ userId, customEnabled, onClose }: ApiKeyModalProps) {
  const { config, ready, save, clear } = useUserApiConfig(userId);
  const [mode, setMode] = useState<CredentialMode>("system");
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLockBodyScroll(true);

  useEffect(() => {
    if (!ready) return;
    setMode(config.mode);
    setApiKey(config.apiKey);
  }, [config.apiKey, config.mode, ready]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => restoreFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectMode = (next: CredentialMode) => {
    setMode(next);
    setError("");
  };

  const submit = () => {
    if (!ready) return;
    const trimmed = apiKey.trim();
    if (mode === "custom") {
      if (!customEnabled) return;
      if (!trimmed) {
        setError("请输入自定义 Key");
        return;
      }
      if (trimmed.length > 500) {
        setError("自定义 Key 最多 500 个字符");
        return;
      }
    }
    save({ mode, apiKey: trimmed });
    onClose();
  };

  const removeKey = () => {
    clear();
    setMode("system");
    setApiKey("");
    setError("");
  };

  return (
    <div className={styles.scrim} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-modal-title"
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            <KeyRound size={18} />
            <h2 id="api-key-modal-title">API 配置</h2>
          </div>
          <button ref={closeRef} type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭" title="关闭">
            <X size={17} />
          </button>
        </div>

        <fieldset className={styles.modeGroup} disabled={!ready}>
          <legend className={styles.label}>生图凭据</legend>
          <div className={styles.segmented}>
            <label className={mode === "system" ? styles.segmentActive : styles.segment}>
              <input
                type="radio"
                name="credential-mode"
                value="system"
                checked={mode === "system"}
                onChange={() => selectMode("system")}
              />
              系统 Key
            </label>
            <label className={mode === "custom" ? styles.segmentActive : styles.segment}>
              <input
                type="radio"
                name="credential-mode"
                value="custom"
                checked={mode === "custom"}
                disabled={!customEnabled}
                onChange={() => selectMode("custom")}
              />
              自定义 Key
            </label>
          </div>
        </fieldset>

        {!customEnabled ? (
          <p className={styles.paused} role="status">自定义 Key 暂停使用，可切换系统 Key</p>
        ) : null}

        {mode === "custom" ? (
          <div className={styles.customFields}>
            <label className={styles.field}>
              <span className={styles.label}>自定义 Key</span>
              <span className={styles.secretInput}>
                <input
                  aria-label="自定义 Key 内容"
                  type={visible ? "text" : "password"}
                  value={apiKey}
                  disabled={!customEnabled || !ready}
                  autoComplete="off"
                  maxLength={500}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setError("");
                  }}
                />
                <button
                  type="button"
                  className={styles.revealButton}
                  onClick={() => setVisible((value) => !value)}
                  disabled={!customEnabled}
                  aria-label={visible ? "隐藏自定义 Key" : "显示自定义 Key"}
                  title={visible ? "隐藏" : "显示"}
                >
                  {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>中转地址</span>
              <input className={styles.readonly} value={CUSTOM_RELAY_BASE_URL} readOnly />
            </label>
            <p className={styles.securityNote}>
              Key 仅保存在当前浏览器；第三方可能按服务商规则计费，请勿在共享设备上使用。
            </p>
          </div>
        ) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <div className={styles.actions}>
          {config.apiKey || apiKey ? (
            <button type="button" className={styles.clearButton} onClick={removeKey}>
              <Trash2 size={15} />
              清除自定义 Key
            </button>
          ) : <span />}
          <button
            type="button"
            className={styles.saveButton}
            onClick={submit}
            disabled={!ready || (mode === "custom" && !customEnabled)}
          >
            保存并使用
          </button>
        </div>
      </div>
    </div>
  );
}
