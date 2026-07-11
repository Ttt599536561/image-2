import { useCallback, useEffect, useState } from "react";
import {
  clearUserApiConfig,
  loadUserApiConfig,
  persistUserApiConfig,
  subscribeUserApiConfig,
  type UserApiConfig,
} from "../lib/userApiConfig";

const fallback = (): UserApiConfig => ({ mode: "system", apiKey: "" });

export function useUserApiConfig(userId: string | undefined) {
  const [snapshot, setSnapshot] = useState<{
    userId: string | undefined;
    config: UserApiConfig;
    ready: boolean;
  }>({ userId: undefined, config: fallback(), ready: false });

  const refresh = useCallback(() => {
    if (!userId) {
      setSnapshot({ userId: undefined, config: fallback(), ready: false });
      return;
    }
    setSnapshot({ userId, config: loadUserApiConfig(userId), ready: true });
  }, [userId]);

  useEffect(() => {
    refresh();
    if (!userId) return;
    return subscribeUserApiConfig(userId, refresh);
  }, [refresh, userId]);

  const matches = snapshot.userId === userId;
  const config = matches ? snapshot.config : fallback();
  const ready = Boolean(userId && matches && snapshot.ready);

  const save = useCallback(
    (next: UserApiConfig) => {
      if (!userId) return fallback();
      const saved = persistUserApiConfig(userId, next);
      setSnapshot({ userId, config: saved, ready: true });
      return saved;
    },
    [userId],
  );

  const clear = useCallback(() => {
    if (!userId) return fallback();
    const cleared = clearUserApiConfig(userId);
    setSnapshot({ userId, config: cleared, ready: true });
    return cleared;
  }, [userId]);

  return { config, ready, save, clear, refresh };
}
