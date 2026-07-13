import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ClipboardCopy,
  Copy,
  Download,
  FileText,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigation } from "react-router";
import { ConversationDetail, type ConversationGeneration } from "../../contracts/conversation";
import type {
  Background,
  GenerateAccepted,
  GenerateParams,
  Quality,
  Size,
  SourceImageSummary,
} from "../../contracts/generate";
import { SaveResponse } from "../../contracts/image";
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, type UploadMime } from "../../contracts/upload";
import type { InspirationItem } from "../../contracts/inspiration";
import {
  type GenerationSubmissionOptions,
  useActiveGenerationEnqueueIds,
  useGeneration,
} from "../../hooks/useGeneration";
import { useGenerationStatuses } from "../../hooks/useGenerationStatus";
import { useUserApiConfig } from "../../hooks/useUserApiConfig";
import { useConversationDetail, useMe } from "../../hooks/queries";
import { apiGet, apiPost } from "../../lib/api-client";
import { PRICE_PER_IMAGE_MP } from "../../lib/credits";
import { formatCredits } from "../../lib/format";
import { generationSubmissionBlock, isGenerationPending } from "../../lib/generationMode";
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
import { ApiKeyModal } from "../shell/ApiKeyModal";
import { useToast } from "../Toast/ToastProvider";
import styles from "./ConversationView.module.css";

// 一轮生成（generations 行 + 可选 images 行），渲染单元（08 §9.4）。
type Turn = ConversationGeneration;
type EditDraft = {
  sourceImageId: string;
  sourceImage: SourceImageSummary;
  request: GenerateParams;
};

const EMPTY_REQUEST: GenerateParams = {
  prompt: "",
  size: "auto",
  quality: "auto",
  background: "auto",
};

// 失败原因（error_code 五值枚举）→ 用户友好中文（卡片显示）。原始报错仍留 DB，供后台「生成记录」排查。
// unknown / 缺 code 时回退原始报错（再回退通用语）。
const FAILURE_MESSAGES: Record<string, string> = {
  provider_timeout: "请求超时，请稍后重试",
  relay_unreachable: "暂时连不上生成服务，请稍后重试",
  insufficient_quota: "生成服务额度暂时不足，请稍后再试或联系站长",
  content_rejected: "提示词未通过内容审核，请调整后重试",
  invalid_request: "生成参数有误（尺寸或格式暂不支持），请调整后重试",
  relay_5xx: "生成服务繁忙，请稍后重试",
  custom_key_invalid: "自定义 Key 无效，请检查后重试",
  custom_key_quota: "自定义 Key 额度不足，请检查服务商账户",
  relay_rate_limited: "生成请求过于频繁，请稍后重试",
  invalid_response: "生成服务返回异常，请重试",
  storage_failed: "图片保存失败，请重试",
  source_image_unavailable: "这张图片已不可编辑",
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
          credentialMode: turn.credentialMode,
          deadlineAt: turn.deadlineAt,
          sourceImageId: turn.sourceImageId,
          errorCode: turn.errorCode,
          error: turn.error,
          httpStatus: turn.httpStatus,
        }
      : {
          status: turn.status,
          credentialMode: turn.credentialMode,
          deadlineAt: turn.deadlineAt,
          sourceImageId: turn.sourceImageId,
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
  const navigation = useNavigation();
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [request, setRequest] = useState<GenerateParams>(EMPTY_REQUEST);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [inputImageFile, setInputImageFile] = useState<File | null>(null); // ④b 图生图参考图（用后即弃）
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rawTurn, setRawTurn] = useState<Turn | null>(null);
  const [keySettingsOpen, setKeySettingsOpen] = useState(false);
  const [displayNow, setDisplayNow] = useState(() => Date.now());
  const [missingTombstones, setMissingTombstones] = useState<Set<string>>(() => new Set());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const conv = detail.data;
  const turns = conv?.generations ?? [];
  const succeededCount = turns.filter((t) => t.status === "succeeded").length;
  const balanceMp = me.data?.balanceMp ?? 0;
  // 单图价取 /api/me 实时值（后台改价即时生效）；无数据时回退常量兜底首帧。
  const priceMp = me.data?.pricePerImageMp ?? PRICE_PER_IMAGE_MP;
  const canAfford = balanceMp >= priceMp;
  const customEnabled = me.data?.customKeyModesEnabled === true;
  const userApiConfig = useUserApiConfig(me.data?.user.id);

  const { submit, isSubmitting } = useGeneration(conversationId, {
    onError: (error) => {
      if (error.code === "CUSTOM_KEY_REQUIRED" || error.code === "CUSTOM_KEY_MODES_DISABLED") {
        setKeySettingsOpen(true);
      }
      toast.error(error.message);
    },
  });
  const activeEnqueueIds = useActiveGenerationEnqueueIds();
  const activeEnqueueSignature = activeEnqueueIds.join("|");
  const activeEnqueueIdSet = new Set(activeEnqueueIds);

  const lastTurn = turns[turns.length - 1];

  const pendingTurns = turns.filter(
    (turn) => isGenerationPending(turn) && !missingTombstones.has(turn.id),
  );
  const pendingIds = pendingTurns.map((turn) => turn.id);
  const pendingSignature = pendingIds.join("|");
  const generationStatuses = useGenerationStatuses(pendingIds);
  const submissionBlock = generationSubmissionBlock({
    config: userApiConfig.config,
    ready: userApiConfig.ready,
    customEnabled,
    isSubmitting: isSubmitting || activeEnqueueIds.length > 0,
    isNavigating: navigation.state !== "idle",
    canAfford,
    turns: turns.filter((turn) => !missingTombstones.has(turn.id)),
  });
  const controlsDisabled =
    submissionBlock === "not_ready" ||
    submissionBlock === "submitting" ||
    submissionBlock === "custom_disabled" ||
    submissionBlock === "system_pending";

  // 终态：刷新会话详情(DB 已落 succeeded/failed) + 余额/资产(成功才扣)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terminalItems = generationStatuses.data?.items.filter(
    (item) => item.status === "succeeded" || item.status === "failed",
  ) ?? [];
  const terminalSignature = terminalItems
    .map((item) => `${item.generationId}:${item.status}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!terminalSignature || !conv?.id) return;
    qc.invalidateQueries({ queryKey: ["conversation", conv.id] });
    const latestTerminalItems = generationStatuses.data?.items.filter(
      (item) => item.status === "succeeded" || item.status === "failed",
    ) ?? [];
    if (latestTerminalItems.some((item) => item.status === "succeeded")) {
      qc.invalidateQueries({ queryKey: ["assets"] });
    }
    if (
      latestTerminalItems.some(
        (item) => item.status === "succeeded" && item.credentialMode === "system",
      )
    ) {
      qc.invalidateQueries({ queryKey: ["me", "balance"] });
    }
  }, [conv?.id, generationStatuses.data?.items, qc, terminalSignature]);

  const missingRefetched = useRef(new Set<string>());
  const missingCounts = useRef(new Map<string, number>());
  useEffect(() => {
    const missing = new Set(generationStatuses.data?.missingIds ?? []);
    for (const id of pendingIds) {
      if (activeEnqueueIdSet.has(id)) {
        missingCounts.current.delete(id);
        missingRefetched.current.delete(id);
        continue;
      }
      if (!missing.has(id)) {
        missingCounts.current.delete(id);
        missingRefetched.current.delete(id);
        continue;
      }
      const count = (missingCounts.current.get(id) ?? 0) + 1;
      missingCounts.current.set(id, count);
      if (count >= 2 && !missingRefetched.current.has(id) && conv) {
        missingRefetched.current.add(id);
        const conversationId = conv.id;
        void apiGet(`/api/conversations/${conversationId}`, ConversationDetail)
          .then((authoritative) => {
            const serverTurn = authoritative.generations.find((turn) => turn.id === id);
            if (serverTurn) {
              missingCounts.current.delete(id);
              missingRefetched.current.delete(id);
              qc.setQueryData(["conversation", conversationId], authoritative);
              return;
            }
            setMissingTombstones((current) => {
              if (current.has(id)) return current;
              const next = new Set(current);
              next.add(id);
              return next;
            });
          })
          .catch(() => {
            missingRefetched.current.delete(id);
          });
      }
    }
  }, [activeEnqueueSignature, conv?.id, generationStatuses.dataUpdatedAt, pendingSignature, qc]);

  useEffect(() => {
    if (pendingTurns.length === 0) return;
    const timer = window.setInterval(() => setDisplayNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingTurns.length]);

  // ⚡ 乐观更新：点「存入资产库」立即把按钮置灰（image.savedToLibrary=true），不等跨境往返。
  // 乐观态与服务端成功态一致（都置 true），故详情无需再 invalidate 重拉；仅刷新资产库列表纳入新图。失败回滚。
  const saveMutation = useMutation({
    mutationFn: (generationId: string) => apiPost("/api/images/save", { generationId }, SaveResponse),
    onMutate: async (generationId: string) => {
      await qc.cancelQueries({ queryKey: ["conversation", conversationId] });
      const prev = qc.getQueryData<ConversationDetail>(["conversation", conversationId]);
      qc.setQueryData<ConversationDetail>(["conversation", conversationId], (old) =>
        old
          ? {
              ...old,
              generations: old.generations.map((g) =>
                g.id === generationId && g.image
                  ? { ...g, image: { ...g.image, savedToLibrary: true } }
                  : g,
              ),
            }
          : old,
      );
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("已存入资产库");
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["conversation", conversationId], ctx.prev);
      toast.error("存入失败，请重试");
    },
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

  useEffect(() => {
    const openKeySettings = (
      location.state as { openKeySettings?: boolean } | null
    )?.openKeySettings;
    if (!openKeySettings) return;
    setKeySettingsOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.pathname, location.state, navigate]);

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

  const runGeneration = (req: GenerateParams, options: GenerationSubmissionOptions = {}) => {
    if (!req.prompt.trim()) return;
    switch (submissionBlock) {
      case "not_ready":
      case "submitting":
        return;
      case "custom_disabled":
        setKeySettingsOpen(true);
        toast.error("自定义 Key 暂停使用，请切换系统 Key 或稍后重试");
        return;
      case "custom_key_missing":
        setKeySettingsOpen(true);
        toast.error("请先填写并保存自定义 Key");
        return;
      case "system_pending":
        toast.info("系统 Key 任务生成中，请稍候");
        return;
      case "insufficient_credits":
        toast.error("积分不足，去充值");
        return;
    }
    submit(req, userApiConfig.config, options);
  };

  const startEditing = (turn: Turn) => {
    if (turn.status !== "succeeded" || !turn.image) return;
    setEditDraft({
      sourceImageId: turn.image.id,
      sourceImage: {
        id: turn.image.id,
        publicUrl: turn.image.publicUrl,
        width: turn.image.width,
        height: turn.image.height,
      },
      request: {
        prompt: "",
        size: turn.size as Size,
        quality: (turn.quality as Quality | null) ?? "auto",
        background: (turn.background as Background | null) ?? "auto",
      },
    });
    window.requestAnimationFrame(focusComposer);
  };

  const setComposerRequest = (next: GenerateParams) => {
    if (editDraft) {
      setEditDraft((current) => (current ? { ...current, request: next } : current));
      return;
    }
    setRequest(next);
  };

  // ④b：参考图选取——父级权威校验类型/大小（与后端 contracts/upload 同值），不合法 toast 不入选。
  const onPickInputImage = (file: File | null) => {
    if (!file) {
      setInputImageFile(null);
      return;
    }
    if (!UPLOAD_ACCEPT.includes(file.type as UploadMime)) {
      toast.error("仅支持 PNG / JPG / WEBP 图片");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      toast.error("参考图过大（上限 4MB）");
      return;
    }
    setInputImageFile(file);
  };

  const onSubmit = () => {
    if (editDraft) {
      runGeneration(editDraft.request, {
        source: {
          sourceImageId: editDraft.sourceImageId,
          sourceImage: editDraft.sourceImage,
        },
        onAccepted: (accepted: GenerateAccepted) => {
          setEditDraft(null);
          window.requestAnimationFrame(() => {
            flowRef.current
              ?.querySelector<HTMLElement>(`[data-generation-id="${accepted.generationId}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        },
      });
      return;
    }
    // 审查 #1：入队成功(202)后才清空 prompt/参考图（失败保留可重试，i2i 尤其避免「丢图须重选」）。
    runGeneration(request, {
      file: inputImageFile,
      onAccepted: () => {
        setRequest((r) => ({ ...r, prompt: "" }));
        setInputImageFile(null); // 用后即弃：一次提交一张参考图
      },
    });
  };

  const bringBackPrompt = (prompt: string) => {
    if (submissionBlock === "system_pending" || submissionBlock === "submitting") {
      toast.info("生成中，请稍候");
      return;
    }
    // 直接回填，不再弹「替换当前输入?」确认（按站长要求）
    setRequest((r) => ({ ...r, prompt }));
    focusComposer();
  };

  // #7：重试 / 重新生成直接带原参发起，不回填输入框、不需用户再点「生成」。
  const regenerate = (turn: Turn) => {
    runGeneration(
      {
        prompt: turn.prompt,
        size: turn.size as Size,
        quality: (turn.quality as Quality | null) ?? "auto",
        background: (turn.background as Background | null) ?? "auto",
      },
      {
        source: turn.sourceImageId
          ? { sourceImageId: turn.sourceImageId, sourceImage: turn.sourceImage }
          : null,
      },
    );
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
      request={editDraft?.request ?? request}
      onChange={setComposerRequest}
      onSubmit={onSubmit}
      disabled={controlsDisabled}
      canAfford={canAfford}
      balanceMp={balanceMp}
      credentialMode={userApiConfig.config.mode}
      customEnabled={customEnabled}
      pricePerImageMp={priceMp}
      variant={turns.length === 0 ? "full" : "compact"}
      textareaRef={textareaRef}
      inputImageFile={editDraft ? null : inputImageFile}
      onPickInputImage={editDraft ? undefined : onPickInputImage}
      editSource={editDraft?.sourceImage ?? null}
      onCancelEdit={() => setEditDraft(null)}
    />
  );
  const keyModal =
    keySettingsOpen && me.data?.user.id ? (
      <ApiKeyModal
        userId={me.data.user.id}
        customEnabled={customEnabled}
        onClose={() => setKeySettingsOpen(false)}
      />
    ) : null;

  // —— 欢迎态（无轮次）——
  if (turns.length === 0) {
    return (
      <>
        <TopBar onOpenMenu={shell.openMenu} onOpenKeySettings={() => setKeySettingsOpen(true)} />
        <div className={styles.welcomeBody}>
          <div className={styles.welcomeInner}>
            <div className={styles.hero}>
              <h1 className={styles.heroTitle}>今天想画点什么?</h1>
              <p className={styles.heroSub}>用一句话描述画面，AI 帮你生成。每张固定 {formatCredits(priceMp)} 积分，成功才扣。</p>
            </div>
            {composer}
            <div className={styles.gallerySection}>
              <p className={styles.galleryLabel}>浏览灵感</p>
              <InspirationGallery items={initialInspirations ?? []} compact onUsePrompt={bringBackPrompt} />
            </div>
          </div>
        </div>
        {rawModal()}
        {keyModal}
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
        onOpenKeySettings={() => setKeySettingsOpen(true)}
      />
      <div className={styles.workRow}>
        <div className={styles.flowCol}>
          <div className={styles.flow} ref={flowRef}>
            <div className={styles.flowInner}>
              {turns.map((turn) => (
                <div className={styles.turn} key={turn.id} data-generation-id={turn.id}>
                  <div className={styles.userBubble}>
                    {turn.prompt}
                    {turn.size !== "auto" ? (
                      <span className={styles.bubbleSize}> · {sizeLabel(turn.size as Size)}</span>
                    ) : null}
                  </div>
                  {renderSourceReference(turn)}
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
      {keyModal}
    </>
  );

  function renderSourceReference(turn: Turn) {
    if (!turn.sourceImageId) return null;
    if (!turn.sourceImage) {
      return <div className={styles.sourceUnavailable}>基于的图片已不可用</div>;
    }
    return (
      <div className={styles.sourceReference}>
        <button
          type="button"
          className={styles.sourceThumbButton}
          aria-label={`查看编辑来源 ${turn.sourceImage.id}`}
          onClick={() =>
            lightbox.open(
              turn.sourceImage!.publicUrl,
              imageFilename(turn.sourceImage!.publicUrl, turn.sourceImage!.id),
            )
          }
        >
          <img
            className={styles.sourceThumb}
            src={turn.sourceImage.publicUrl}
            alt="编辑来源"
          />
        </button>
        <div className={styles.sourceMeta}>
          <span className={styles.sourceLabel}>基于此图编辑</span>
          <code className={styles.sourceId} title={turn.sourceImage.id}>
            {turn.sourceImage.id}
          </code>
        </div>
      </div>
    );
  }

  function renderResult(turn: Turn) {
    if (missingTombstones.has(turn.id)) {
      return (
        <div className={styles.errorCard}>
          <div className={styles.errorHead}>
            <AlertTriangle size={16} />
            任务不存在或无权访问
          </div>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              missingCounts.current.delete(turn.id);
              missingRefetched.current.delete(turn.id);
              setMissingTombstones((current) => {
                const next = new Set(current);
                next.delete(turn.id);
                return next;
              });
            }}
          >
            <RefreshCw size={14} />
            重新检查
          </button>
        </div>
      );
    }
    if (turn.status === "running" || turn.status === "queued" || turn.status === "claimed") {
      if (displayNow > Date.parse(turn.deadlineAt) + 10_000) {
        return (
          <div className={styles.errorCard}>
            <div className={styles.errorHead}>
              <AlertTriangle size={16} />
              状态确认中，请重试刷新
            </div>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => {
                generationStatuses.refetch();
                detail.refetch();
              }}
            >
              <RefreshCw size={14} />
              刷新状态
            </button>
          </div>
        );
      }
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
          <p className={styles.errorNote}>
            {turn.credentialMode === "custom"
              ? "本站未扣积分；第三方计费以服务商规则为准。"
              : "本次未扣 / 已退积分。"}
          </p>
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
          {turn.image ? (
            <button type="button" className={styles.chip} onClick={() => startEditing(turn)}>
              <Pencil size={13} />
              编辑图片
            </button>
          ) : null}
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
