import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ConversationDetail, ConversationListResponse } from "../contracts/conversation";
import {
  GenerateAcceptedResponse,
  type GenerateAccepted,
  type GenerateParams,
  type SourceImageSummary,
} from "../contracts/generate";
import type { MeResponse } from "../contracts/me";
import { UploadResponse } from "../contracts/upload";
import { ApiError, apiPost, apiPostForm } from "../lib/api-client";
import type { UserApiConfig } from "../lib/userApiConfig";

// 提交一轮生成（08 §9.7）。⚡ 乐观立即跳转：
//  - 点击瞬间生成 cid/gid、把"排队中的乐观 turn"写进会话详情缓存、立即 navigate(/c/cid)，
//    用户当即看到生图骨架，**不等任何跨境往返**（POST 异步在后台跑）。
//  - 服务端用客户端 cid/gid（enqueue owner-safe upsert / generations 同 id），轮询即时对上、无闪烁。
//  - POST 写成 "脱离组件生命周期" 的独立 async：导航后旧组件卸载，但缓存是单例、qc 操作仍生效，对账照常。
//  - 失败（402/409/429/5xx）→ 把该乐观 turn 标 failed（用户原地见失败卡 + 可重试 #7，prompt 不丢）。
//  - 并发/余额/预算闸仍由服务端权威（402/409/429）→ onError 回调（toast）。不可取消。
export interface UseGenerationOptions {
  onError?: (error: ApiError) => void;
}

export interface GenerationSubmissionOptions {
  file?: File | null;
  source?: {
    sourceImageId: string;
    sourceImage: SourceImageSummary | null;
  } | null;
  onAccepted?: (accepted: GenerateAccepted) => void;
}

type Turn = ConversationDetail["generations"][number];
const ACTIVE_ENQUEUE_IDS_KEY = ["generation-active-enqueue-ids"] as const;

function beginEnqueue(qc: ReturnType<typeof useQueryClient>, generationId: string): void {
  qc.setQueryData<string[]>(ACTIVE_ENQUEUE_IDS_KEY, (current = []) =>
    current.includes(generationId) ? current : [...current, generationId],
  );
}

function finishEnqueue(qc: ReturnType<typeof useQueryClient>, generationId: string): void {
  qc.setQueryData<string[]>(ACTIVE_ENQUEUE_IDS_KEY, (current = []) =>
    current.filter((id) => id !== generationId),
  );
}

export function useActiveGenerationEnqueueIds(): string[] {
  return useQuery<string[]>({
    queryKey: ACTIVE_ENQUEUE_IDS_KEY,
    queryFn: async () => [],
    initialData: [],
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  }).data;
}

function makeOptimisticTurn(
  gid: string,
  req: GenerateParams,
  createdAt: string,
  config: UserApiConfig,
  source: GenerationSubmissionOptions["source"] = null,
): Turn {
  return {
    id: gid,
    prompt: req.prompt,
    size: req.size,
    quality: req.quality ?? null,
    background: req.background ?? null,
    credentialMode: config.mode,
    deadlineAt: new Date(Date.parse(createdAt) + 5 * 60_000).toISOString(),
    sourceImageId: source?.sourceImageId ?? null,
    sourceImage: source?.sourceImage ?? null,
    status: "queued",
    errorCode: null,
    error: null,
    httpStatus: null,
    creditsChargedMp: 0,
    durationMs: null,
    createdAt,
    image: null,
  };
}

export function useGeneration(conversationId: string | null, opts: UseGenerationOptions = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // 同步硬锁挡「同帧双击/连发」→ 两次上传 + 两次入队 + 两次扣费（审查 #6）。
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // opts.onError 每渲染可能是新函数 → 放 ref，避免 submit 依赖它而频繁重建。
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;

  const submit = useCallback(
    (req: GenerateParams, config: UserApiConfig, options: GenerationSubmissionOptions = {}) => {
      if (submittingRef.current) return; // 双闸：同步 ref
      const customApiKey = config.apiKey.trim();
      if (config.mode === "custom" && !customApiKey) {
        onErrorRef.current?.(new ApiError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key"));
        return;
      }
      submittingRef.current = true;
      setIsSubmitting(true);

      const isNew = !conversationId;
      const cid = conversationId ?? crypto.randomUUID();
      const gid = crypto.randomUUID();
      const now = new Date().toISOString();
      const title = req.prompt.slice(0, 20) || "新对话";
      const turn = makeOptimisticTurn(gid, req, now, config, options.source);
      beginEnqueue(qc, gid);

      // 乐观写会话详情缓存（新建=造一条；续聊=追加一轮）。
      qc.setQueryData<ConversationDetail>(["conversation", cid], (old) =>
        old
          ? { ...old, updatedAt: now, generations: [...old.generations, turn] }
          : { id: cid, title, createdAt: now, updatedAt: now, generations: [turn] },
      );

      if (isNew) {
        // 乐观把新会话置顶进侧栏列表（覆盖所有 ["conversations", *] 缓存）。
        qc.setQueriesData<ConversationListResponse>({ queryKey: ["conversations"] }, (old) =>
          old ? { ...old, items: [{ id: cid, title, updatedAt: now }, ...old.items], total: old.total + 1 } : old,
        );
        navigate(`/c/${cid}`); // ⚡ 立即跳转：clientLoader 命中刚写的缓存 → 即时渲染生图骨架
      }
      // 独立 async：不绑组件生命周期。导航后旧组件卸载，但 qc 是单例、操作仍命中活缓存。
      void (async () => {
        try {
          let inputImageKey: string | undefined;
          if (options.file) {
            const fd = new FormData();
            fd.append("file", options.file);
            const up = await apiPostForm("/api/uploads", fd, UploadResponse);
            inputImageKey = up.inputImageKey;
          }
          const accepted = await apiPost(
            "/api/generate",
            {
              ...req,
              credentialMode: config.mode,
              ...(config.mode === "custom" ? { customApiKey } : {}),
              conversationId: cid,
              generationId: gid,
              inputImageKey,
              ...(options.source ? { sourceImageId: options.source.sourceImageId } : {}),
            },
            GenerateAcceptedResponse,
          );
          qc.setQueryData<ConversationDetail>(["conversation", cid], (old) =>
            old
              ? {
                  ...old,
                  generations: old.generations.map((generation) =>
                    generation.id === gid
                      ? {
                          ...generation,
                          credentialMode: accepted.credentialMode,
                          deadlineAt: accepted.deadlineAt,
                        }
                      : generation,
                  ),
                }
              : old,
          );
          options.onAccepted?.(accepted);
          // 服务端已建会话 + queued 行（同 cid/gid）→ 拉真数据校正缓存 + 刷新侧栏。
          qc.invalidateQueries({ queryKey: ["conversation", accepted.conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(500, "INTERNAL", "服务异常，请重试");
          if (err.code === "CUSTOM_KEY_MODES_DISABLED") {
            qc.setQueryData<ConversationDetail>(["conversation", cid], (old) =>
              old
                ? { ...old, generations: old.generations.filter((generation) => generation.id !== gid) }
                : old,
            );
            if (isNew) {
              qc.removeQueries({ queryKey: ["conversation", cid], exact: true });
              qc.setQueriesData<ConversationListResponse>({ queryKey: ["conversations"] }, (old) =>
                old
                  ? {
                      ...old,
                      items: old.items.filter((conversation) => conversation.id !== cid),
                      total: Math.max(0, old.total - 1),
                    }
                  : old,
              );
            }
            qc.setQueryData<MeResponse>(["me", "balance"], (old) =>
              old ? { ...old, customKeyModesEnabled: false } : old,
            );
            qc.invalidateQueries({ queryKey: ["me", "balance"] });
            if (isNew) navigate("/", { replace: true, state: { openKeySettings: true } });
          } else {
          // 把该乐观 turn 标 failed（友好中文卡由 ConversationView 据 error 兜底；可点重试）。
            qc.setQueryData<ConversationDetail>(["conversation", cid], (old) =>
              old
                ? {
                    ...old,
                    generations: old.generations.map((g) =>
                      g.id === gid
                        ? {
                            ...g,
                            status: "failed",
                            errorCode:
                              err.code === "SOURCE_IMAGE_UNAVAILABLE"
                                ? "source_image_unavailable"
                                : null,
                            error: err.message,
                          }
                        : g,
                    ),
                  }
                : old,
            );
          }
          onErrorRef.current?.(err);
        } finally {
          finishEnqueue(qc, gid);
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      })();
    },
    [conversationId, navigate, qc],
  );

  return { submit, isSubmitting };
}
