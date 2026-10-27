import type { ConversationDetail, ConversationGeneration } from "../contracts/conversation";
import type { GenerateStatusBatchResponse, GenerateStatusResponse } from "../contracts/generate";

const rank = { queued: 0, claimed: 1, running: 2, succeeded: 3, failed: 3 } as const;
const terminal = (status: keyof typeof rank) => rank[status] === 3;
type CachedGeneration = ConversationGeneration & { _localEnqueueFailure?: true };
const localFailure = (turn: ConversationGeneration) => (turn as CachedGeneration)._localEnqueueFailure === true;

export function mergeGenerationStatusBatch(
  current: GenerateStatusBatchResponse | undefined,
  incoming: GenerateStatusBatchResponse,
  knownIds: string[],
): GenerateStatusBatchResponse {
  const known = new Set(knownIds);
  const previous = new Map(current?.items.map((item) => [item.generationId, item]));
  const items = new Map<string, GenerateStatusResponse>();
  for (const item of incoming.items) {
    if (!known.has(item.generationId)) continue;
    const old = previous.get(item.generationId);
    items.set(item.generationId, old && (terminal(old.status) || rank[old.status] > rank[item.status]) ? old : item);
  }
  // A late poll or snapshot taken before the insert must not erase committed completion.
  for (const [id, old] of previous) if (known.has(id) && terminal(old.status)) items.set(id, old);
  return {
    items: [...items.values()],
    missingIds: incoming.missingIds.filter((id) => known.has(id) && !items.has(id)),
  };
}

export function mergeConversationStatuses(
  current: ConversationDetail,
  statuses: GenerateStatusResponse[],
): ConversationDetail {
  const byId = new Map(statuses.map((status) => [status.generationId, status]));
  let changed = false;
  const generations = current.generations.map((turn): ConversationGeneration => {
    const status = byId.get(turn.id);
    if (!status || (!localFailure(turn) && (terminal(turn.status) || rank[turn.status] > rank[status.status]))) return turn;
    if (!localFailure(turn) && turn.status === status.status && turn.deadlineAt === status.deadlineAt) return turn;
    changed = true;
    const { _localEnqueueFailure: _discardLocalFailure, ...confirmedTurn } = turn as CachedGeneration;
    const identity = {
      ...confirmedTurn, status: status.status, credentialMode: status.credentialMode,
      deadlineAt: status.deadlineAt, sourceImageId: status.sourceImageId, sourceImage: status.sourceImage,
    };
    if (status.status === "succeeded") return {
      ...identity, image: status.image, creditsChargedMp: status.creditsChargedMp,
      durationMs: status.durationMs, errorCode: null, error: null, httpStatus: null,
    };
    if (status.status === "failed") return {
      ...identity, image: null, creditsChargedMp: 0, errorCode: status.errorCode,
      error: status.error, httpStatus: status.httpStatus,
    };
    return { ...identity, errorCode: null, error: null, httpStatus: null };
  });
  return changed ? { ...current, generations } : current;
}

/** Reconcile fetched snapshots racing a terminal event or an enqueue. */
export function reconcileConversationDetail(
  current: ConversationDetail | undefined,
  incoming: ConversationDetail,
  activeEnqueueIds: string[] = [],
): ConversationDetail {
  if (!current || current.id !== incoming.id) return incoming;
  const previous = new Map(current.generations.map((turn) => [turn.id, turn]));
  const generations = incoming.generations.map((turn) => {
    const old = previous.get(turn.id);
    return old && !localFailure(old) && terminal(old.status) && !terminal(turn.status) ? old : turn;
  });
  const received = new Set(generations.map((turn) => turn.id));
  const enqueuing = new Set(activeEnqueueIds);
  for (const turn of current.generations) {
    if (!received.has(turn.id) && enqueuing.has(turn.id)) generations.push(turn);
  }
  return { ...incoming, generations };
}
