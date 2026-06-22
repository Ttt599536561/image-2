import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ClipboardCopy,
  Copy,
  Download,
  FileText,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { ConversationDetail, ConversationGeneration } from "../../contracts/conversation";
import type { Background, GenerateRequest, Quality, Size } from "../../contracts/generate";
import { SaveResponse } from "../../contracts/image";
import type { InspirationItem } from "../../contracts/inspiration";
import { useGeneration } from "../../hooks/useGeneration";
import { useGenerationStatus } from "../../hooks/useGenerationStatus";
import { useConversationDetail, useMe } from "../../hooks/queries";
import { apiPost } from "../../lib/api-client";
import { PRICE_PER_IMAGE_MP } from "../../lib/credits";
import { copyImageToClipboard, downloadImage, imageFilename } from "../../lib/download";
import { redactText } from "../../lib/redaction";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { Composer } from "../composer/Composer";
import { CosmicSkeleton } from "../composer/CosmicSkeleton";
import { sizeLabel } from "../composer/sizeOptions";
import { InspirationGallery } from "../InspirationGallery/InspirationGallery";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { useShell } from "../shell/ShellContext";
import { ThisConversationPanel } from "../shell/ThisConversationPanel";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./ConversationView.module.css";

// 一轮生成（generations 行 + 可选 images 行），渲染单元（08 §9.4）。
type Turn = ConversationGeneration;

const EMPTY_REQUEST: GenerateRequest = {
  prompt: "",
  size: "auto",
  quality: "auto",
  background: "auto",
};

// 失败原因（error_code 五值枚举）→ 用户友好中文（卡片显示）。原始报错仍留 DB，供后台「生成记录」排查。
// unknown / 缺 code 时回退原始报错（再回退通用语）。
const FAILURE_MESSAGES: Record<string, string> = {
  provider_timeout: "生成超时（服务响应过慢），未扣积分，请重试",
  relay_unreachable: "暂时连不上生成服务，请稍后重试",
  insufficient_quota: "生成服务额度暂时不足，请稍后再试或联系站长",
  content_rejected: "提示词未通过内容审核，请调整后重试",
  invalid_request: "生成参数有误（尺寸或格式暂不支持），请调整后重试",
  relay_5xx: "生成服务繁忙，请稍后重试",
};
// #5：用户卡片只显友好中文，绝不直显中转英文原文（原文仍可经「查看原始响应」/后台生成记录排查）。
function failureMessage(code: string | null | undefined, _raw?: string | null): string {
  return (code ? FAILURE_MESSAGES[code] : undefined) ?? "生成失败，请重试";
}

function rawResponseOf(turn: Turn): string {
  const obj =
    turn.status === "failed"
      ? {
          status: "failed",
          errorCode: turn.errorCode,
          error: turn.error,
          httpStatus: turn.httpStatus,
        }
      : {
          status: turn.status,
          model: "gpt-image-2",
          size: turn.size,
          image: turn.image ? { width: turn.image.width, height: turn.image.height } : null,
        };
  return redactText(JSON.stringify(obj, null, 2));
}

export function ConversationView({
  conversationId,
  initialDetail,
  initialInspirations,
}: {
  conversationId: string | null;
  initialDetail?: ConversationDetail;
  initialInspirations?: InspirationItem[];
}) {
  const me = useMe();
  const detail = useConversationDetail(conversationId, initialDetail);
  const qc = useQueryClient();
  const toast = useToast();
  const lightbox = useLightbox();
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [request, setRequest] = useState<GenerateRequest>(EMPTY_REQUEST);
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rawTurn, setRawTurn] = useState<Turn | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const { submit, isSubmitting } = useGeneration(conversationId, {
    onError: (e) => toast.error(e.message),
  });

  const conv = detail.data;
  const turns = conv?.generations ?? [];
  const succeededCount = turns.filter((t) => t.status === "succeeded").length;
  const balanceMp = me.data?.balanceMp ?? 0;
  const canAfford = balanceMp >= PRICE_PER_IMAGE_MP;

  const lastTurn = turns[turns.length - 1];

  // 轮询由「会话详情里的进行中轮」驱动（跨 "/"→"/c/:id" 路由切换不丢；DB 为真相源）。
  const TIMEOUT_MS = 5 * 60_000 + 10_000;
  const pendingTurn = turns.find(
    (t) => t.status === "queued" || t.status === "claimed" || t.status === "running",
  );
  const pendingId = pendingTurn?.id ?? null;
  const [, forceTick] = useState(0);
  const genStatus = useGenerationStatus(pendingId);
  const statusVal = genStatus.data?.status;
  const isTerminal = statusVal === "succeeded" || statusVal === "failed";
  const timedOut = pendingTurn ? Date.now() - Date.parse(pendingTurn.createdAt) > TIMEOUT_MS : false;
  const isGenerating = isSubmitting || (pendingId !== null && !isTerminal && !timedOut);

  // 终态：刷新会话详情(DB 已落 succeeded/failed) + 余额/资产(成功才扣)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (statusVal !== "succeeded" && statusVal !== "failed") return;
    if (conv) qc.invalidateQueries({ queryKey: ["conversation", conv.id] });
    if (statusVal === "succeeded") {
      qc.invalidateQueries({ queryKey: ["me", "balance"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    }
  }, [statusVal]);

  // 前端 5min 兜底：满则强制重渲染释放 UI + 拉一次最新（权威终态在服务端 cron，§5.5）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingId || !pendingTurn) return;
    const remaining = TIMEOUT_MS - (Date.now() - Date.parse(pendingTurn.createdAt));
    const t = setTimeout(
      () => {
        forceTick((n) => n + 1);
        if (conv) qc.invalidateQueries({ queryKey: ["conversation", conv.id] });
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(t);
  }, [pendingId]);

  const saveMutation = useMutation({
    mutationFn: (generationId: string) => apiPost("/api/images/save", { generationId }, SaveResponse),
    onSuccess: () => {
      if (conv) qc.invalidateQueries({ queryKey: ["conversation", conv.id] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("已存入资产库");
    },
    onError: () => toast.error("存入失败，请重试"),
  });

  // 新轮加入 OR 末轮态变化（骨架→成品/失败，结果通常更高）后滚到底
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    flowRef.current?.scrollTo({ top: flowRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, lastTurn?.status]);

  // 跨路由一键带回（来自 /inspiration）：走与欢迎态同一受控路径（isGenerating 拦截 + 非空确认），再清 state。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const bring = (location.state as { bringPrompt?: string } | null)?.bringPrompt;
    if (!bring) return;
    navigate(location.pathname, { replace: true });
    bringBackPrompt(bring);
  }, [location.key]);

  // 原始响应弹窗：打开时锁背景滚动 + ESC 关闭
  useLockBodyScroll(rawTurn !== null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rawTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRawTurn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rawTurn]);

  const focusComposer = () => {
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const runGeneration = (req: GenerateRequest) => {
    if (!req.prompt.trim()) return;
    if (balanceMp < PRICE_PER_IMAGE_MP) {
      toast.error("积分不足，去充值");
      return;
    }
    submit(req);
  };

  const onSubmit = () => {
    runGeneration(request);
    setRequest((r) => ({ ...r, prompt: "" }));
  };

  const bringBackPrompt = (prompt: string) => {
    if (isGenerating) {
      toast.info("生成中，请稍候");
      return;
    }
    // 直接回填，不再弹「替换当前输入?」确认（按站长要求）
    setRequest((r) => ({ ...r, prompt }));
    focusComposer();
  };

  // #7：重试 / 重新生成直接带原参发起，不回填输入框、不需用户再点「生成」。
  const regenerate = (turn: Turn) => {
    if (isGenerating) {
      toast.info("生成中，请稍候");
      return;
    }
    runGeneration({
      prompt: turn.prompt,
      size: turn.size as Size,
      quality: (turn.quality as Quality | null) ?? "auto",
      background: (turn.background as Background | null) ?? "auto",
    });
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard?.writeText(prompt).then(
      () => toast.success("已复制提示词"),
      () => toast.error("复制失败"),
    );
  };

  // #19：复制图片本身（blob）到剪贴板，不是复制链接。
  const copyImage = (url: string) => {
    copyImageToClipboard(url).then(
      () => toast.success("图片已复制到剪贴板"),
      () => toast.error("复制图片失败，请改用下载"),
    );
  };

  const saveToLibrary = (turn: Turn) => {
    if (!turn.image || turn.image.savedToLibrary) return;
    saveMutation.mutate(turn.id);
  };

  const composer = (
    <Composer
      request={request}
      onChange={setRequest}
      onSubmit={onSubmit}
      disabled={isGenerating}
      canAfford={canAfford}
      balanceMp={balanceMp}
      variant={turns.length === 0 ? "full" : "compact"}
      textareaRef={textareaRef}
    />
  );

  // —— 欢迎态（无轮次）——
  if (turns.length === 0) {
    return (
      <>
        <TopBar onOpenMenu={shell.openMenu} />
        <div className={styles.welcomeBody}>
          <div className={styles.welcomeInner}>
            <div className={styles.hero}>
              <h1 className={styles.heroTitle}>今天想画点什么?</h1>
              <p className={styles.heroSub}>用一句话描述画面，AI 帮你生成。每张固定 0.07 积分，成功才扣。</p>
            </div>
            {composer}
            <div className={styles.gallerySection}>
              <p className={styles.galleryLabel}>浏览灵感</p>
              <InspirationGallery items={initialInspirations ?? []} compact onUsePrompt={bringBackPrompt} />
            </div>
          </div>
        </div>
        {rawModal()}
      </>
    );
  }

  // —— 工作态（生成中 / 成功 / 失败混排）——
  return (
    <>
      <TopBar
        title={conv?.title}
        currentLabel="（当前对话）"
        thisCount={succeededCount}
        panelOpen={isDesktop ? panelOpen : drawerOpen}
        onTogglePanel={() => (isDesktop ? setPanelOpen((o) => !o) : setDrawerOpen((o) => !o))}
        onOpenMenu={shell.openMenu}
      />
      <div className={styles.workRow}>
        <div className={styles.flowCol}>
          <div className={styles.flow} ref={flowRef}>
            <div className={styles.flowInner}>
              {turns.map((turn) => (
                <div className={styles.turn} key={turn.id}>
                  <div className={styles.userBubble}>
                    {turn.prompt}
                    {turn.size !== "auto" ? (
                      <span className={styles.bubbleSize}> · {sizeLabel(turn.size as Size)}</span>
                    ) : null}
                  </div>
                  {renderResult(turn)}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.composerDock}>
            <div className={styles.composerDockInner}>{composer}</div>
          </div>
        </div>
        {/* 列在 ≥1024 由 CSS 显示、<1024 由 CSS 隐藏（不用 JS isDesktop 门控，避免首帧三栏闪烁） */}
        {panelOpen ? <ThisConversationPanel turns={turns} mode="column" /> : null}
      </div>
      {drawerOpen ? (
        <ThisConversationPanel turns={turns} mode="drawer" onClose={() => setDrawerOpen(false)} />
      ) : null}
      {rawModal()}
    </>
  );

  function renderResult(turn: Turn) {
    if (turn.status === "running" || turn.status === "queued" || turn.status === "claimed") {
      return (
        <div className={styles.resultMedia}>
          <CosmicSkeleton size={turn.size as Size} startedAt={Date.parse(turn.createdAt)} />
        </div>
      );
    }
    if (turn.status === "failed") {
      return (
        <div className={styles.errorCard}>
          <div className={styles.errorHead}>
            <AlertTriangle size={16} />
            {failureMessage(turn.errorCode, turn.error)}
          </div>
          <p className={styles.errorNote}>本次未扣 / 已退积分。</p>
          <button type="button" className={styles.retryBtn} onClick={() => regenerate(turn)}>
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      );
    }
    // succeeded
    const saved = turn.image?.savedToLibrary === true;
    return (
      <div>
        <span className={styles.doneTag}>
          <Check size={13} />
          已完成
          {turn.durationMs ? (
            <span className={styles.doneDuration}>· 用时 {Math.round(turn.durationMs / 1000)}s</span>
          ) : null}
        </span>
        {turn.image ? (
          <div className={styles.resultMedia}>
            <img
              className={styles.resultImage}
              src={turn.image.publicUrl}
              alt={turn.prompt}
              onClick={() =>
                turn.image &&
                lightbox.open(turn.image.publicUrl, imageFilename(turn.image.publicUrl, turn.id))
              }
            />
            {/* #20：下载按钮移到图片右下角悬浮 */}
            <button
              type="button"
              className={styles.mediaDownload}
              title="下载"
              aria-label="下载图片"
              onClick={(e) => {
                e.stopPropagation();
                if (turn.image)
                  downloadImage(turn.image.publicUrl, imageFilename(turn.image.publicUrl, turn.id));
              }}
            >
              <Download size={15} />
            </button>
          </div>
        ) : null}
        <div className={styles.actionBar}>
          {/* #20：原「下载」位置换成「复制图片」（#19 复制 blob 到剪贴板） */}
          <button
            type="button"
            className={styles.chip}
            onClick={() => turn.image && copyImage(turn.image.publicUrl)}
          >
            <Copy size={13} />
            复制图片
          </button>
          <button type="button" className={styles.chip} onClick={() => regenerate(turn)}>
            <RefreshCw size={13} />
            重新生成
          </button>
          <button type="button" className={styles.chip} onClick={() => copyPrompt(turn.prompt)}>
            <ClipboardCopy size={13} />
            复制提示词
          </button>
          <button type="button" className={styles.chip} onClick={() => setRawTurn(turn)}>
            <FileText size={13} />
            查看原始响应
          </button>
          <button
            type="button"
            className={`${styles.chip} ${saved ? styles.chipDone : ""}`}
            onClick={() => saveToLibrary(turn)}
            disabled={saved}
          >
            <Bookmark size={13} />
            {saved ? "已存入" : "存入资产库"}
          </button>
        </div>
      </div>
    );
  }

  function rawModal() {
    if (!rawTurn) return null;
    return (
      <div className={styles.rawScrim} onClick={() => setRawTurn(null)}>
        <div
          className={styles.rawCard}
          role="dialog"
          aria-modal="true"
          aria-label="原始响应"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.rawHead}>
            <span className={styles.rawTitle}>原始响应（已脱敏）</span>
            <button type="button" className={styles.rawClose} onClick={() => setRawTurn(null)} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
          <pre className={styles.rawPre}>{rawResponseOf(rawTurn)}</pre>
        </div>
      </div>
    );
  }
}
