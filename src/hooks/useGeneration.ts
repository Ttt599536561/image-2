import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ConversationDetail, ConversationListResponse } from "../contracts/conversation";
import { GenerateAcceptedResponse, type GenerateRequest } from "../contracts/generate";
import { UploadResponse } from "../contracts/upload";
import { ApiError, apiPost, apiPostForm } from "../lib/api-client";

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

type Turn = ConversationDetail["generations"][number];

function makeOptimisticTurn(gid: string, req: GenerateRequest, createdAt: string): Turn {
  return {
    id: gid,
    prompt: req.prompt,
    size: req.size,
    quality: req.quality ?? null,
    background: req.background ?? null,
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
    (req: GenerateRequest, file: File | null = null, onAccepted?: () => void) => {
      if (submittingRef.current) return; // 双闸：同步 ref
      submittingRef.current = true;
      setIsSubmitting(true);

      const isNew = !conversationId;
      const cid = conversationId ?? crypto.randomUUID();
      const gid = crypto.randomUUID();
      const now = new Date().toISOString();
      const title = req.prompt.slice(0, 20) || "新对话";
      const turn = makeOptimisticTurn(gid, req, now);

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
      onAccepted?.(); // 立即清空 composer（乐观；失败时 turn 标 failed 可重试，prompt 留在 turn 上）

      // 独立 async：不绑组件生命周期。导航后旧组件卸载，但 qc 是单例、操作仍命中活缓存。
      void (async () => {
        try {
          let inputImageKey: string | undefined;
          if (file) {
            const fd = new FormData();
            fd.append("file", file);
            const up = await apiPostForm("/api/uploads", fd, UploadResponse);
            inputImageKey = up.inputImageKey;
          }
          const accepted = await apiPost(
            "/api/generate",
            { ...req, conversationId: cid, generationId: gid, inputImageKey },
            GenerateAcceptedResponse,
          );
          // 服务端已建会话 + queued 行（同 cid/gid）→ 拉真数据校正缓存 + 刷新侧栏。
          qc.invalidateQueries({ queryKey: ["conversation", accepted.conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(500, "INTERNAL", "服务异常，请重试");
          // 把该乐观 turn 标 failed（友好中文卡由 ConversationView 据 error 兜底；可点重试）。
          qc.setQueryData<ConversationDetail>(["conversation", cid], (old) =>
            old
              ? {
                  ...old,
                  generations: old.generations.map((g) =>
                    g.id === gid ? { ...g, status: "failed", errorCode: null, error: err.message } : g,
                  ),
                }
              : old,
          );
          onErrorRef.current?.(err);
        } finally {
          submittingRef.current = false;
          setIsSubmitting(false);
        }
      })();
    },
    [conversationId, navigate, qc],
  );

  return { submit, isSubmitting };
}
