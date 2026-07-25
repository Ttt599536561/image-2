import { useEffect, useRef, useState } from "react";
import { PROJECT_NAME_MAX } from "../../contracts/project";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import styles from "./ProjectNameDialog.module.css";

// F-074 项目名弹窗（新建 / 重命名共用）：网站中间模态，输入框 + 取消/保存。
// ESC / 点遮罩 = 取消；Enter = 保存；空名禁止保存。
export interface ProjectNameDialogProps {
  open: boolean;
  title: string;
  initialName?: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function ProjectNameDialog({
  open,
  title,
  initialName = "",
  busy = false,
  onSubmit,
  onCancel,
}: ProjectNameDialogProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useLockBodyScroll(open);
  useEffect(() => {
    if (!open) return;
    setName(initialName); // 每次打开重置为当前名
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, initialName, onCancel]);

  if (!open) return null;
  const trimmed = name.trim();
  const submit = () => {
    if (busy || !trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.title}>{title}</h3>
        <input
          ref={inputRef}
          className={styles.input}
          value={name}
          maxLength={PROJECT_NAME_MAX}
          autoFocus
          disabled={busy}
          placeholder="项目名称"
          aria-label="项目名称"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={styles.confirm} onClick={submit} disabled={busy || !trimmed}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
