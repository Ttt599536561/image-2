import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { GenerateAcceptedResponse, type GenerateRequest } from "../contracts/generate";
import { ApiError, apiPost } from "../lib/api-client";

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

  const mutation = useMutation({
    mutationFn: (req: GenerateRequest) =>
      apiPost(
        "/api/generate",
        { ...req, conversationId: conversationId ?? undefined },
        GenerateAcceptedResponse,
      ),
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
  });

  const submit = useCallback(
    (req: GenerateRequest) => {
      if (!mutation.isPending) mutation.mutate(req);
    },
    [mutation],
  );

  return { submit, isSubmitting: mutation.isPending };
}
