import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_MAX_CONCURRENCY,
  MOCK_REDEEM,
  MOCK_USER,
  SEED_BALANCE_MP,
  SEED_CONVERSATIONS,
  SEED_EXPIRING_SOON,
} from "./data";
import type { Conversation, ExpiringSoon, MockUser, Turn } from "./types";

// 阶段一 mock 会话/积分客户端态（单一 Provider）。阶段二把读写换成 loader/REST + Neon/Better Auth。

export type RedeemResult =
  | { ok: true; creditsMp: number; balanceMp: number }
  | { ok: false; code: "CODE_NOT_FOUND" | "CODE_USED" | "CODE_DISABLED" };

interface MockState {
  user: MockUser;
  balanceMp: number;
  maxConcurrency: number;
  hasPaid: boolean;
  expiringSoon: ExpiringSoon;
  conversations: Conversation[];
  activeId: string | null; // "/" 新会话工作态（首次提交懒建）
}

interface MockApi extends MockState {
  getConversation: (id: string | null | undefined) => Conversation | undefined;
  inProgressCount: () => number;
  startNewConversation: () => void;
  /** 取/建当前提交目标会话；conversationId 为空 → 在 "/" 懒建并设为 active。返回会话 id。 */
  ensureConversation: (conversationId: string | null, firstPrompt: string) => string;
  addTurn: (conversationId: string, turn: Turn) => void;
  updateTurn: (conversationId: string, turnId: string, patch: Partial<Turn>) => void;
  saveToLibrary: (conversationId: string, turnId: string) => void;
  debit: (mp: number) => void;
  credit: (mp: number) => void;
  redeem: (code: string) => RedeemResult;
}

const Ctx = createContext<MockApi | null>(null);

function titleFromPrompt(prompt: string): string {
  const t = prompt.trim().slice(0, 20);
  return t.length ? t : "新的创作";
}

export function MockProvider({ children }: { children: ReactNode }) {
  const [balanceMp, setBalanceMp] = useState(SEED_BALANCE_MP);
  const [expiringSoon, setExpiringSoon] = useState<ExpiringSoon>(SEED_EXPIRING_SOON);
  const [hasPaid, setHasPaid] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(SEED_CONVERSATIONS);
  const [activeId, setActiveId] = useState<string | null>(null);

  const getConversation = useCallback(
    (id: string | null | undefined) => conversations.find((c) => c.id === id),
    [conversations],
  );

  const inProgressCount = useCallback(
    () => conversations.reduce((n, c) => n + c.turns.filter((t) => t.status === "running").length, 0),
    [conversations],
  );

  const startNewConversation = useCallback(() => setActiveId(null), []);

  const ensureConversation = useCallback(
    (conversationId: string | null, firstPrompt: string): string => {
      if (conversationId) return conversationId;
      if (activeId) return activeId;
      const id = `c-${crypto.randomUUID().slice(0, 8)}`;
      const conv: Conversation = {
        id,
        title: titleFromPrompt(firstPrompt),
        updatedAt: new Date().toISOString(),
        turns: [],
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveId(id);
      return id;
    },
    [activeId],
  );

  const addTurn = useCallback((conversationId: string, turn: Turn) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, updatedAt: new Date().toISOString(), turns: [...c.turns, turn] }
          : c,
      ),
    );
  }, []);

  const updateTurn = useCallback(
    (conversationId: string, turnId: string, patch: Partial<Turn>) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) }
            : c,
        ),
      );
    },
    [],
  );

  const saveToLibrary = useCallback(
    (conversationId: string, turnId: string) =>
      updateTurn(conversationId, turnId, { savedToLibrary: true }),
    [updateTurn],
  );

  const debit = useCallback((mp: number) => setBalanceMp((b) => Math.max(0, b - mp)), []);
  const credit = useCallback((mp: number) => {
    setBalanceMp((b) => b + mp);
    setHasPaid(true);
  }, []);

  const redeem = useCallback(
    (code: string): RedeemResult => {
      const entry = MOCK_REDEEM[code.toUpperCase()];
      if (!entry) return { ok: false, code: "CODE_NOT_FOUND" };
      if (entry.kind === "used") return { ok: false, code: "CODE_USED" };
      if (entry.kind === "disabled") return { ok: false, code: "CODE_DISABLED" };
      const creditsMp = entry.creditsMp ?? 0;
      let next = balanceMp;
      setBalanceMp((b) => {
        next = b + creditsMp;
        return next;
      });
      setHasPaid(true);
      return { ok: true, creditsMp, balanceMp: next };
    },
    [balanceMp],
  );

  const value = useMemo<MockApi>(
    () => ({
      user: MOCK_USER,
      balanceMp,
      maxConcurrency: DEFAULT_MAX_CONCURRENCY,
      hasPaid,
      expiringSoon,
      conversations,
      activeId,
      getConversation,
      inProgressCount,
      startNewConversation,
      ensureConversation,
      addTurn,
      updateTurn,
      saveToLibrary,
      debit,
      credit,
      redeem,
    }),
    [
      balanceMp,
      hasPaid,
      expiringSoon,
      conversations,
      activeId,
      getConversation,
      inProgressCount,
      startNewConversation,
      ensureConversation,
      addTurn,
      updateTurn,
      saveToLibrary,
      debit,
      credit,
      redeem,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMock(): MockApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMock must be used within <MockProvider>");
  return ctx;
}
