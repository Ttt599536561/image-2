import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import adminStyles from "../../src/components/admin/Admin.module.css";
import styles from "../../src/components/admin/SystemUpdate.module.css";
import {
  StartSystemUpdateResponse,
  UpdateSnapshot,
  type SystemUpdatePhase,
  type SystemUpdateStatus,
} from "../../src/contracts/system-update";
import { ApiError, apiGet, apiPost } from "../../src/lib/api-client";

const REQUEST_STORAGE_KEY = "ai-image-workshop:update-request";
const POLL_INTERVAL_MS = 2_000;
const STARTABLE_PHASES = new Set<SystemUpdatePhase>(["idle", "completed", "failed", "recovered"]);
const TERMINAL_PHASES = new Set<SystemUpdatePhase>([
  "completed",
  "failed",
  "recovery_required",
  "recovered",
]);

const PHASE_LABELS: Record<SystemUpdatePhase, string> = {
  idle: "等待更新",
  claiming: "正在接收更新请求",
  validating: "正在校验更新",
  checking_release: "正在核对版本",
  preflight: "正在执行更新前检查",
  entering_maintenance: "正在进入维护模式",
  draining: "正在等待当前任务完成",
  stopping_writers: "正在停止写入服务",
  backing_up: "正在备份数据库",
  fetching: "正在下载新版本",
  building: "正在构建新版本",
  migrating: "正在升级数据库",
  starting_services: "正在启动服务",
  health_check: "正在检查服务状态",
  completed: "更新完成",
  failed: "更新失败，已回滚",
  recovery_required: "需要人工恢复",
  recovering: "正在恢复数据库",
  recovered: "恢复完成",
};

function isActive(status: SystemUpdateStatus | null): boolean {
  return Boolean(
    status?.requestId &&
      !STARTABLE_PHASES.has(status.phase) &&
      !TERMINAL_PHASES.has(status.phase),
  );
}

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UPDATE_CONFLICT") return "更新状态已变化，请刷新后重试。";
    if (error.code === "UPDATE_UNAVAILABLE") {
      return "更新服务暂不可用，请检查主机更新器是否已初始化。";
    }
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

export default function SystemUpdatePage() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [storedRequestId, setStoredRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async (initial = false) => {
    try {
      const next = await apiGet("/api/admin/system-update", UpdateSnapshot);
      setSnapshot((current) => {
        if (
          next.releaseState !== "unchecked" ||
          current?.latestRelease == null ||
          current.build.version !== next.build.version
        ) {
          return next;
        }
        return {
          ...next,
          releaseState: current.releaseState,
          latestRelease: current.latestRelease,
        };
      });
      setReconnecting(false);
      setError(null);
      setStoredRequestId((requestId) => {
        if (
          requestId &&
          next.status?.requestId === requestId &&
          TERMINAL_PHASES.has(next.status.phase)
        ) {
          sessionStorage.removeItem(REQUEST_STORAGE_KEY);
          return null;
        }
        return requestId;
      });
    } catch (requestError) {
      setReconnecting(true);
      if (initial) setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStoredRequestId(sessionStorage.getItem(REQUEST_STORAGE_KEY));
    void refreshStatus(true);
  }, [refreshStatus]);

  const polling = isActive(snapshot?.status ?? null) || storedRequestId !== null;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refreshStatus]);

  const status = snapshot?.status ?? null;
  const release = snapshot?.latestRelease ?? null;
  const canStart = Boolean(
    snapshot?.enabled &&
      snapshot.releaseState === "available" &&
      release &&
      status &&
      !status.maintenance &&
      STARTABLE_PHASES.has(status.phase) &&
      !storedRequestId &&
      !starting,
  );

  const fallbackRequestId = storedRequestId ?? status?.requestId ?? null;
  const fallbackCommand = fallbackRequestId
    ? `sudo /usr/local/sbin/ai-image-workshop-update status ${fallbackRequestId}`
    : null;
  const recoveryCommand = status?.recoveryCommand ?? null;

  const releaseStateText = useMemo(() => {
    if (!snapshot) return "正在读取版本信息";
    if (!snapshot.enabled) return "更新功能未启用";
    if (snapshot.releaseState === "unchecked") return "尚未检查 GitHub 最新版本";
    if (snapshot.releaseState === "none") return "GitHub 暂无可用的稳定版本";
    if (snapshot.releaseState === "up_to_date") return "当前已是最新稳定版本";
    return `发现新版本 v${release?.version ?? ""}`;
  }, [snapshot, release]);

  async function checkForUpdates() {
    setChecking(true);
    setError(null);
    try {
      const next = await apiPost("/api/admin/system-update/check", {}, UpdateSnapshot);
      setSnapshot(next);
      setReconnecting(false);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setChecking(false);
    }
  }

  async function startUpdate() {
    setStarting(true);
    setError(null);
    try {
      const result = await apiPost(
        "/api/admin/system-update",
        { action: "start" },
        StartSystemUpdateResponse,
      );
      sessionStorage.setItem(REQUEST_STORAGE_KEY, result.requestId);
      setStoredRequestId(result.requestId);
      setConfirmOpen(false);
      await refreshStatus();
    } catch (requestError) {
      setError(errorMessage(requestError));
      setConfirmOpen(false);
    } finally {
      setStarting(false);
    }
  }

  async function copyCommand(command: string) {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <>
      <div className={adminStyles.pageHead}>
        <h1 className={adminStyles.pageTitle}>系统更新</h1>
        <button
          type="button"
          className={adminStyles.btn}
          disabled={loading || checking || !snapshot?.enabled || polling}
          onClick={() => void checkForUpdates()}
        >
          <RefreshCw size={15} className={checking ? styles.spin : undefined} />
          {checking ? "正在检查" : "检查更新"}
        </button>
      </div>

      {error ? (
        <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {reconnecting && fallbackCommand ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">
          <LoaderCircle size={18} className={styles.spin} />
          <div>
            <strong>服务重启中，正在重新连接</strong>
            <p>如果页面长时间未恢复，可在服务器执行：</p>
            <code>{fallbackCommand}</code>
          </div>
        </div>
      ) : null}

      {!snapshot?.enabled && snapshot?.disabledReason ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>系统更新暂不可用</strong>
            <p>{snapshot.disabledReason}</p>
          </div>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="current-version-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>当前部署</p>
              <h2 id="current-version-title">版本信息</h2>
            </div>
            <span className={`${styles.stateBadge} ${styles.stateNeutral}`}>
              {loading ? "读取中" : `v${snapshot?.build.version ?? "-"}`}
            </span>
          </div>
          <dl className={styles.details}>
            <div>
              <dt>当前版本</dt>
              <dd>v{snapshot?.build.version ?? "-"}</dd>
            </div>
            <div>
              <dt>构建提交</dt>
              <dd className={styles.mono}>{snapshot?.build.shortCommitSha ?? "-"}</dd>
            </div>
            <div>
              <dt>最近状态</dt>
              <dd>{status ? PHASE_LABELS[status.phase] : "未初始化"}</dd>
            </div>
            <div>
              <dt>状态更新时间</dt>
              <dd>{formatTime(status?.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="release-title">
          <div className={styles.panelHead}>
            <div>
              <p className={styles.eyebrow}>GitHub Release</p>
              <h2 id="release-title">可用更新</h2>
            </div>
            {snapshot?.releaseState === "available" ? (
              <span className={`${styles.stateBadge} ${styles.stateAvailable}`}>有新版本</span>
            ) : snapshot?.releaseState === "up_to_date" ? (
              <span className={`${styles.stateBadge} ${styles.stateSuccess}`}>已是最新</span>
            ) : null}
          </div>
          <div className={styles.releaseSummary}>
            {snapshot?.releaseState === "up_to_date" ? (
              <CheckCircle2 size={22} />
            ) : (
              <RefreshCw size={22} />
            )}
            <p>{releaseStateText}</p>
          </div>

          {release ? (
            <div className={styles.releaseDetails}>
              <div className={styles.releaseTitleRow}>
                <strong>{release.name || release.tag}</strong>
                <a href={release.htmlUrl} target="_blank" rel="noreferrer">
                  查看发布页 <ExternalLink size={14} />
                </a>
              </div>
              <p className={styles.releaseMeta}>发布于 {formatTime(release.publishedAt)}</p>
              {release.summary ? <p className={styles.releaseNotes}>{release.summary}</p> : null}
            </div>
          ) : null}

          <button
            type="button"
            className={`${adminStyles.btn} ${adminStyles.btnPrimary} ${styles.updateButton}`}
            disabled={!canStart}
            onClick={() => setConfirmOpen(true)}
          >
            <Download size={16} />
            立即更新
          </button>
        </section>
      </div>

      {status && (isActive(status) || TERMINAL_PHASES.has(status.phase)) ? (
        <section className={styles.progressBand} aria-labelledby="update-progress-title">
          <div className={styles.progressIcon}>
            {status.phase === "completed" || status.phase === "recovered" ? (
              <CheckCircle2 size={22} />
            ) : status.phase === "failed" || status.phase === "recovery_required" ? (
              <AlertTriangle size={22} />
            ) : (
              <LoaderCircle size={22} className={styles.spin} />
            )}
          </div>
          <div className={styles.progressContent}>
            <p className={styles.eyebrow}>更新进度</p>
            <h2 id="update-progress-title">{PHASE_LABELS[status.phase]}</h2>
            <p>
              请求编号：<code>{status.requestId ?? "-"}</code>
            </p>
            {status.targetVersion ? <p>目标版本：v{status.targetVersion}</p> : null}
            {status.errorMessage ? <p className={styles.errorText}>{status.errorMessage}</p> : null}
            {recoveryCommand ? (
              <div className={styles.commandRow}>
                <code>{recoveryCommand}</code>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="复制恢复命令"
                  title="复制恢复命令"
                  onClick={() => void copyCommand(recoveryCommand)}
                >
                  <Copy size={16} />
                </button>
                {copied ? <span>已复制</span> : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={`更新到 v${release?.version ?? "最新版本"}`}
        message={`将从 v${snapshot?.build.version ?? "当前版本"} 更新到 v${release?.version ?? "最新版本"}。系统会先排空任务并备份数据库，维护通常需要数分钟，期间页面可能暂时断开。确认现在开始更新吗？`}
        confirmLabel={starting ? "正在提交" : "开始更新"}
        busy={starting}
        onConfirm={() => void startUpdate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
