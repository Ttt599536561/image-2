import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { GenerateAcceptedResponse, type GenerateRequest } from "../contracts/generate";
import { UploadResponse } from "../contracts/upload";
import { ApiError, apiPost, apiPostForm } from "../lib/api-client";

// 提交一轮生成（08 §9.7）。⑤ 接真：
//  - submit → POST /api/generate（202 {generationId,conversationId}）→ invalidate 会话详情/侧栏；
//    首次在 "/" 提交后 navigate(/c/:id)。
//  - 轮询由 ConversationView 依「会话详情里的进行中轮」驱动（跨路由 unmount 仍续轮询，见 ConversationView）。
//  - 并发/余额/预算闸由服务端权威（402/409/429）→ onError 回调（前端 toast）。不可取消。
export interface UseGenerationOptions {
  onError?: (error: ApiError) => void;
}

export function useGeneration(conversationId: string | null, opts: UseGenerationOptions = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // ④b：不依赖渲染时序的同步硬锁，挡「同帧双击/连发」→ 两次上传 + 两次入队 + 两次扣费（审查 #6）。
  const submittingRef = useRef(false);

  const mutation = useMutation({
    // ④b 图生图：有参考图 File → 先 multipart 上传换 inputImageKey，再带 key 入队（isSubmitting 覆盖整段）。
    mutationFn: async ({ req, file }: { req: GenerateRequest; file: File | null }) => {
      let inputImageKey: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await apiPostForm("/api/uploads", fd, UploadResponse);
        inputImageKey = up.inputImageKey;
      }
      return apiPost(
        "/api/generate",
        { ...req, conversationId: conversationId ?? undefined, inputImageKey },
        GenerateAcceptedResponse,
      );
    },
    onSuccess: (accepted) => {
      // 新轮已 queued 入库 → 刷新会话详情(显示骨架) + 侧栏(新会话/续聊 bump)。
      qc.invalidateQueries({ queryKey: ["conversation", accepted.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      // 首次在 "/" 提交：服务端建会话 → 跳 /c/:id（08 §9.2）。
      if (!conversationId) navigate(`/c/${accepted.conversationId}`);
    },
    onError: (e) => {
      opts.onError?.(e instanceof ApiError ? e : new ApiError(500, "INTERNAL", "服务异常，请重试"));
    },
    onSettled: () => {
      submittingRef.current = false; // 结算（成功/失败）即解锁
    },
  });

  // onAccepted：仅本次提交「入队成功(202)」后调 —— 用于清空 prompt/参考图（失败则不调，保留可重试，审查 #1）。
  // 走 mutate 的 per-call onSuccess（而非全局），故 regenerate/retry 不传它 → 不会误清 Composer 草稿。
  const submit = useCallback(
    (req: GenerateRequest, file: File | null = null, onAccepted?: () => void) => {
      if (submittingRef.current || mutation.isPending) return; // 双闸：同步 ref + isPending 兜底
      submittingRef.current = true;
      mutation.mutate({ req, file }, { onSuccess: () => onAccepted?.() });
    },
    [mutation],
  );

  return { submit, isSubmitting: mutation.isPending };
}
