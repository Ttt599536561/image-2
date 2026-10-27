import { describe, expect, it } from "vitest";
import type { ConversationDetail, ConversationGeneration } from "../contracts/conversation";
import type { GenerateStatusResponse } from "../contracts/generate";
import { mergeConversationStatuses, mergeGenerationStatusBatch, reconcileConversationDetail } from "./generationStatusCache";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const imageId = "00000000-0000-4000-8000-000000000003";
const identity = { generationId: id, credentialMode: "custom" as const, deadlineAt: "2026-10-27T12:00:00.000Z", sourceImageId: null, sourceImage: null };
const success: GenerateStatusResponse = { ...identity, status: "succeeded", creditsChargedMp: 0, durationMs: 123, image: { id: imageId, publicUrl: "/media/result.png", width: 1024, height: 1024, savedToLibrary: false } };
const pending: ConversationGeneration = {
  id, prompt: "keep prompt", size: "auto", quality: "high", background: null, ...identity,
  status: "queued", errorCode: null, error: null, httpStatus: null, creditsChargedMp: 0,
  durationMs: null, createdAt: identity.deadlineAt, image: null,
};
const conversation: ConversationDetail = { id: otherId, title: "conversation", createdAt: identity.deadlineAt, updatedAt: identity.deadlineAt, generations: [pending] };

describe("authoritative generation cache updates", () => {
  it("renders complete image metadata from status without needing a detail fetch", () => {
    const result = mergeConversationStatuses(conversation, [success]);
    expect(result.generations[0]).toMatchObject({ status: "succeeded", image: success.image, prompt: "keep prompt", durationMs: 123 });
  });
  it("ignores unknown jobs and never replaces terminal results with stale pending", () => {
    const completed = mergeConversationStatuses(conversation, [success]);
    const result = mergeConversationStatuses(completed, [{ ...identity, status: "queued" }, { ...success, generationId: otherId }]);
    expect(result.generations).toEqual(completed.generations);
    expect(result.generations).toHaveLength(1);
  });
  it("preserves optimistic submissions and terminal cache entries during a stale detail fetch", () => {
    const completed = mergeConversationStatuses(conversation, [success]);
    completed.generations.push({ ...pending, id: imageId });
    const result = reconcileConversationDetail(completed, conversation, [imageId]);
    expect(result.generations.map((turn) => [turn.id, turn.status])).toEqual([[id, "succeeded"], [imageId, "queued"]]);
    expect(reconcileConversationDetail(completed, { ...conversation, generations: [] }, []).generations).toEqual([]);
  });
  it("discards foreign statuses and missing races while retaining newer terminal status", () => {
    const merged = mergeGenerationStatusBatch({ items: [success], missingIds: [] }, {
      items: [{ ...identity, status: "queued" }, { ...success, generationId: otherId }], missingIds: [id, otherId],
    }, [id]);
    expect(merged).toEqual({ items: [success], missingIds: [] });
  });
  it("preserves an optimistic save against a duplicate completion event", () => {
    const completed = mergeConversationStatuses(conversation, [success]);
    completed.generations[0].image!.savedToLibrary = true;
    expect(mergeConversationStatuses(completed, [success]).generations[0].image!.savedToLibrary).toBe(true);
  });
  it("recovers server pending state after a locally failed enqueue response", () => {
    const localFailure = { ...conversation, generations: [{ ...pending, status: "failed" as const, error: "response lost", _localEnqueueFailure: true as const }] };
    expect(reconcileConversationDetail(localFailure, conversation).generations[0].status).toBe("queued");
    const updated = mergeConversationStatuses(localFailure, [{ ...identity, status: "running" }]);
    expect(updated.generations[0].status).toBe("running");
    expect(updated.generations[0]).not.toHaveProperty("_localEnqueueFailure");
    const completed = mergeConversationStatuses(localFailure, [success]);
    expect(completed.generations[0].status).toBe("succeeded");
    const failed = mergeConversationStatuses(localFailure, [{ ...identity, status: "failed", error: "server failure", errorCode: "unknown", httpStatus: null, creditsChargedMp: 0 }]);
    expect(failed.generations[0]).not.toHaveProperty("_localEnqueueFailure");
    expect(reconcileConversationDetail(failed, conversation).generations[0].status).toBe("failed");
  });
});
