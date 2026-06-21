import { AlertTriangle, Bookmark, Check, Copy, Download, FileText, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { GenerateRequest } from "../../contracts/generate";
import { downloadImage, imageFilename } from "../../lib/download";
import { redactText } from "../../lib/redaction";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { PRICE_PER_IMAGE_MP } from "../../mocks/api";
import { MOCK_INSPIRATIONS } from "../../mocks/data";
import { useMock } from "../../mocks/store";
import type { Turn } from "../../mocks/types";
import { useGeneration } from "../../hooks/useGeneration";
import { Composer } from "../composer/Composer";
import { sizeLabel } from "../composer/sizeOptions";
import { CosmicSkeleton } from "../composer/CosmicSkeleton";
import { InspirationGallery } from "../InspirationGallery/InspirationGallery";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { useShell } from "../shell/ShellContext";
import { ThisConversationPanel } from "../shell/ThisConversationPanel";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./ConversationView.module.css";

const EMPTY_REQUEST: GenerateRequest = {
  prompt: "",
  size: "auto",
  quality: "auto",
  background: "auto",
};

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

export function ConversationView({ conversationId }: { conversationId: string | null }) {
  const mock = useMock();
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

  const { submit, isGenerating } = useGeneration(conversationId);

  const currentId = conversationId ?? mock.activeId;
  const conv = mock.getConversation(currentId);
  const turns = conv?.turns ?? [];
  const succeededCount = turns.filter((t) => t.status === "succeeded").length;
  const canAfford = mock.balanceMp >= PRICE_PER_IMAGE_MP;

  const lastTurn = turns[turns.length - 1];

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
    if (mock.balanceMp < PRICE_PER_IMAGE_MP) {
      toast.error("积分不足，去充值");
      return;
    }
    void submit(req);
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

  const regenerate = (turn: Turn) => {
    if (isGenerating) {
      toast.info("生成中，请稍候");
      return;
    }
    setRequest({
      prompt: turn.prompt,
      size: turn.size,
      quality: turn.quality ?? "auto",
      background: turn.background ?? "auto",
    });
    focusComposer();
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard?.writeText(prompt).then(
      () => toast.success("已复制"),
      () => toast.error("复制失败"),
    );
  };

  const saveToLibrary = (turn: Turn) => {
    if (!conv || turn.savedToLibrary) return;
    mock.saveToLibrary(conv.id, turn.id);
    toast.success("已存入资产库");
  };

  const composer = (
    <Composer
      request={request}
      onChange={setRequest}
      onSubmit={onSubmit}
      disabled={isGenerating}
      canAfford={canAfford}
      balanceMp={mock.balanceMp}
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
              <p className={styles.galleryLabel}>浏览灵感（站长维护，点卡片一键带回提示词）</p>
              <InspirationGallery items={MOCK_INSPIRATIONS} compact onUsePrompt={bringBackPrompt} />
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
                      <span className={styles.bubbleSize}> · {sizeLabel(turn.size)}</span>
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
    if (turn.status === "running") {
      return (
        <div className={styles.resultMedia}>
          <CosmicSkeleton size={turn.size} startedAt={Date.parse(turn.createdAt)} />
        </div>
      );
    }
    if (turn.status === "failed") {
      return (
        <div className={styles.errorCard}>
          <div className={styles.errorHead}>
            <AlertTriangle size={16} />
            {turn.error ?? "生成失败，请重试"}
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
    return (
      <div>
        <span className={styles.doneTag}>
          <Check size={13} />
          已完成
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
          </div>
        ) : null}
        <div className={styles.actionBar}>
          <button
            type="button"
            className={styles.chip}
            onClick={() =>
              turn.image && downloadImage(turn.image.publicUrl, imageFilename(turn.image.publicUrl, turn.id))
            }
          >
            <Download size={13} />
            下载
          </button>
          <button type="button" className={styles.chip} onClick={() => regenerate(turn)}>
            <RefreshCw size={13} />
            重新生成
          </button>
          <button type="button" className={styles.chip} onClick={() => copyPrompt(turn.prompt)}>
            <Copy size={13} />
            复制提示词
          </button>
          <button type="button" className={styles.chip} onClick={() => setRawTurn(turn)}>
            <FileText size={13} />
            查看原始响应
          </button>
          <button
            type="button"
            className={`${styles.chip} ${turn.savedToLibrary ? styles.chipDone : ""}`}
            onClick={() => saveToLibrary(turn)}
            disabled={turn.savedToLibrary}
          >
            <Bookmark size={13} />
            {turn.savedToLibrary ? "已存入" : "存入资产库"}
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
