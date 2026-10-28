// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sql: vi.fn(), claim: vi.fn(), markRunning: vi.fn(), incMs: vi.fn(), budget: vi.fn(),
  charge: vi.fn(), finalize: vi.fn(), cleanup: vi.fn(), load: vi.fn(),
}));
vi.mock("../../db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("../money/preempt.server", () => ({ claim: mocks.claim, markRunning: mocks.markRunning, claimNext: mocks.claim }));
vi.mock("../money/debit.server", () => ({ chargeOnSuccess: mocks.charge }));
vi.mock("../budget.server", () => ({ incMs: mocks.incMs, incCallIfUnderCap: mocks.budget, markBudgetAlertedOnce: vi.fn() }));
vi.mock("./credential.server", () => ({ deleteGenerationCredential: mocks.cleanup, loadCustomApiKey: vi.fn(), loadCustomCredential: mocks.load }));
vi.mock("./finalizeCustom.server", () => ({ finalizeCustomSuccess: mocks.finalize }));
import { runGenerationJob } from "./process";

const stored = { storageKey: "key", publicUrl: "/media/key", contentType: "image/png", sizeBytes: 1 };
describe("generation deadline and ancillary failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.claim.mockResolvedValue({ id: "job", userId: "owner", prompt: "private prompt", credentialMode: "system", deadlineAt: new Date(Date.now() + 1_000), createdAt: new Date(Date.now() - 100) });
    mocks.markRunning.mockResolvedValue(true);
    mocks.budget.mockResolvedValue(true);
    mocks.charge.mockResolvedValue({ outcome: "charged" });
    mocks.finalize.mockResolvedValue("succeeded");
    mocks.sql.mockResolvedValue([{ id: "job" }]);
    mocks.load.mockResolvedValue({ mode: "custom", apiKey: "private custom key", baseUrl: "https://provider.example/custom/v1" });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("passes the deadline signal to storage and aborts pending IO without charging", async () => {
    let storageSignal: AbortSignal | undefined;
    const work = runGenerationJob("job", {
      callRelay: async () => ({ images: [{ b64_json: "aA==" }] }),
      putToR2: async (_uid, _gid, _image, signal) => {
        storageSignal = signal;
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storageSignal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await work).toBe("failed");
    expect(storageSignal?.aborted).toBe(true);
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("uses the whole frozen custom credential including its provider base URL", async () => {
    mocks.claim.mockResolvedValue({ ...(await mocks.claim()), credentialMode: "custom" });
    const relay = vi.fn(async () => ({ images: [{ b64_json: "aA==" }] }));
    expect(await runGenerationJob("job", { callRelay: relay, putToR2: async () => stored })).toBe("succeeded");
    expect(relay).toHaveBeenCalledWith(expect.objectContaining({ credential: { mode: "custom", apiKey: "private custom key", baseUrl: "https://provider.example/custom/v1" } }));
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("rejects a late storage result even if the IO implementation ignores cancellation", async () => {
    let finish!: (result: typeof stored) => void;
    const work = runGenerationJob("job", {
      callRelay: async () => ({ images: [{ b64_json: "aA==" }] }),
      putToR2: async () => new Promise((resolve) => { finish = resolve; }),
    });
    await vi.advanceTimersByTimeAsync(1_001);
    finish(stored);
    expect(await work).toBe("failed");
    expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("does not call relay after losing the claimed-to-running transition", async () => {
    mocks.markRunning.mockResolvedValue(false);
    const relay = vi.fn();
    expect(await runGenerationJob("job", { callRelay: relay })).toBe("lost");
    expect(relay).not.toHaveBeenCalled();
  });

  it("keeps committed success when timing or monitoring fails", async () => {
    mocks.incMs.mockRejectedValue(new Error("database unavailable"));
    vi.mocked(console.log).mockImplementation(() => { throw new Error("log unavailable"); });
    expect(await runGenerationJob("job", {
      callRelay: async () => ({ images: [{ b64_json: "aA==" }] }), putToR2: async () => stored,
    })).toBe("succeeded");
    expect(mocks.charge).toHaveBeenCalledOnce();
  });

  it("isolates custom cleanup failure and logs no credential, prompt, or raw error", async () => {
    mocks.claim.mockResolvedValue({ ...(await mocks.claim()), credentialMode: "custom" });
    mocks.cleanup.mockRejectedValue(new Error("private custom key"));
    expect(await runGenerationJob("job", {
      callRelay: async () => ({ images: [{ b64_json: "aA==" }] }), putToR2: async () => stored,
    })).toBe("succeeded");
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.incMs).not.toHaveBeenCalled();
    const logs = JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.warn).mock.calls]);
    expect(logs).not.toContain("private");
    expect(logs).toContain("credential_cleanup_failed");
  });
});
