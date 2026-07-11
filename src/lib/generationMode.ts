import type { UserApiConfig } from "./userApiConfig";

export type GenerationSubmissionBlock =
  | "not_ready"
  | "submitting"
  | "custom_disabled"
  | "custom_key_missing"
  | "system_pending"
  | "insufficient_credits";

interface PendingTurnLike {
  status: string;
  credentialMode: "system" | "custom";
}

export function isGenerationPending(turn: PendingTurnLike): boolean {
  return turn.status === "queued" || turn.status === "claimed" || turn.status === "running";
}

export function generationSubmissionBlock(args: {
  config: UserApiConfig;
  ready: boolean;
  customEnabled: boolean;
  isSubmitting: boolean;
  isNavigating: boolean;
  canAfford: boolean;
  turns: PendingTurnLike[];
}): GenerationSubmissionBlock | null {
  if (!args.ready) return "not_ready";
  if (args.isSubmitting || args.isNavigating) return "submitting";
  if (args.config.mode === "custom") {
    if (!args.customEnabled) return "custom_disabled";
    if (!args.config.apiKey.trim()) return "custom_key_missing";
    return null;
  }
  if (args.turns.some((turn) => turn.credentialMode === "system" && isGenerationPending(turn))) {
    return "system_pending";
  }
  if (!args.canAfford) return "insufficient_credits";
  return null;
}
