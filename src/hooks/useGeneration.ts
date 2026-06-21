import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerateRequest } from "../contracts/generate";
import { mockGenerate } from "../mocks/api";
import { useMock } from "../mocks/store";
import type { Turn } from "../mocks/types";
import { useGenerationStatus } from "./useGenerationStatus";

// 一个 useGeneration 包住「提交→轮询→落结果」（docs/dev 08 §9.7）。
// conversationId 为空 = 在 "/" 懒建会话；非空 = 续聊该会话。
export function useGeneration(conversationId: string | null) {
  const mock = useMock();
  const [activeGenId, setActiveGenId] = useState<string | null>(null);
  const target = useRef<{ convId: string; turnId: string } | null>(null);
  const status = useGenerationStatus(activeGenId);

  const submit = useCallback(
    async (req: GenerateRequest) => {
      if (activeGenId) return; // 单 composer 同时只跑一轮（不可取消）
      const convId = mock.ensureConversation(conversationId, req.prompt);
      const accepted = await mockGenerate(req); // 202
      const turn: Turn = {
        id: accepted.generationId,
        prompt: req.prompt,
        size: req.size,
        quality: req.quality,
        background: req.background,
        status: "running",
        createdAt: new Date().toISOString(),
      };
      mock.addTurn(convId, turn);
      target.current = { convId, turnId: accepted.generationId };
      setActiveGenId(accepted.generationId);
    },
    [activeGenId, conversationId, mock],
  );

  // 终态：落结果 + 成功才扣（debit）。
  useEffect(() => {
    const data = status.data;
    const t = target.current;
    if (!data || !t) return;
    if (data.status === "succeeded") {
      mock.updateTurn(t.convId, t.turnId, {
        status: "succeeded",
        image: data.image,
      });
      mock.debit(data.creditsChargedMp); // 成功才扣 0.07
      target.current = null;
      setActiveGenId(null);
    } else if (data.status === "failed") {
      mock.updateTurn(t.convId, t.turnId, {
        status: "failed",
        errorCode: data.errorCode,
        error: data.error,
        httpStatus: data.httpStatus,
      });
      target.current = null;
      setActiveGenId(null);
    }
  }, [status.data, mock]);

  return { submit, isGenerating: activeGenId !== null };
}
