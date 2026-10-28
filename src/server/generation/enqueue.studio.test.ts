// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), encrypt: vi.fn(), project: vi.fn() }));
vi.mock("../tx.server", () => ({ tx: (fn: Function) => fn({ query: mock.query }) }));
vi.mock("./credential.server", () => ({ encryptCustomApiKey: mock.encrypt }));
vi.mock("../projects.server", () => ({ ensureDefaultProject: mock.project }));
import { enqueueGeneration } from "./enqueue";
const user = { id: "00000000-0000-4000-8000-000000000001", maxConcurrency: 10 };
const id = "00000000-0000-4000-8000-000000000002";
const conv = "00000000-0000-4000-8000-000000000003";
const input = { prompt: "a tree", size: "1024x1024", credentialMode: "custom" as const, customApiKey: "secret", customBaseUrl: "https://api.tangguo.xin/v1", generationId: id };

describe("anonymous studio enqueue", () => {
  beforeEach(() => {
    mock.encrypt.mockReset().mockReturnValue({ ciphertext: "sealed", iv: "iv", authTag: "tag", keyVersion: 2 });
    mock.project.mockReset().mockResolvedValue(conv);
    mock.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id,user_id,conversation_id,credential_mode,deadline_at")) return { rows: [], rowCount: 0 };
      if (sql.includes("COUNT(*)")) return { rows: [{ owner_count: 0, global_count: 0 }], rowCount: 1 };
      if (sql.includes("INSERT INTO conversations")) return { rows: [{ id: conv }], rowCount: 1 };
      if (sql.includes("INSERT INTO generations")) return { rows: [{ id, deadline_at: "2026-10-28T12:00:00Z" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  });
  it("freezes the URL with the key and never queries monetary tables", async () => {
    await enqueueGeneration({ user, input });
    expect(mock.encrypt).toHaveBeenCalledWith(id, "secret", input.customBaseUrl);
    const sql = mock.query.mock.calls.map(([s]) => s).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).not.toMatch(/credit_accounts|credit_lots|credit_ledger|budget|global_config/);
  });
  it("replays the same owned task before limits without duplicating credentials", async () => {
    mock.query.mockImplementation(async (sql: string) => sql.includes("SELECT id,user_id,conversation_id,credential_mode,deadline_at")
      ? { rows: [{ id, user_id: user.id, conversation_id: conv, credential_mode: "custom", deadline_at: "2026-10-28T12:00:00Z" }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    expect(await enqueueGeneration({ user, input })).toMatchObject({ generationId: id, conversationId: conv });
    expect(mock.query.mock.calls.some(([s]) => s.includes("INSERT INTO generations"))).toBe(false);
    expect(mock.query.mock.calls.some(([s]) => s.includes("INSERT INTO generation_credentials"))).toBe(false);
  });
  it.each([[10, 10], [1, 100]])("limits owner/global in-flight work atomically (%i/%i)", async (owner_count, global_count) => {
    const base = mock.query.getMockImplementation()!;
    mock.query.mockImplementation((sql: string) => sql.includes("COUNT(*)") ? Promise.resolve({ rows: [{ owner_count, global_count }], rowCount: 1 }) : base(sql));
    await expect(enqueueGeneration({ user, input })).rejects.toMatchObject({ status: 429 });
    expect(mock.query.mock.calls.some(([s]) => s.includes("INSERT INTO generations"))).toBe(false);
  });
  it("rejects a generation id owned by someone else", async () => {
    mock.query.mockImplementation(async (sql: string) => sql.includes("SELECT id,user_id,conversation_id,credential_mode,deadline_at")
      ? { rows: [{ id, user_id: conv, credential_mode: "custom" }], rowCount: 1 } : { rows: [], rowCount: 1 });
    await expect(enqueueGeneration({ user, input })).rejects.toMatchObject({ status: 404 });
  });
  it("persists the selected model and ordered reference list without the legacy single field", async () => {
    const inputImageKeys = [1, 2, 3, 4].map((n) => `uploads/${user.id}/${n}.png`);
    await enqueueGeneration({ user, input: { ...input, model: "gpt-image-2.5-sunburst", inputImageKeys } });
    const [sql, values] = mock.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO generations"))!;
    expect(sql).toContain("input_image_keys");
    expect(values).toContain("gpt-image-2.5-sunburst");
    expect(values).toContain(JSON.stringify(inputImageKeys));
    expect(values).not.toContain(inputImageKeys[0]);
  });
  it.each([
    { customBaseUrl: "https://evil.example/v1" }, { model: "unsupported" },
    { inputImageKeys: ["uploads/other/1.png"] },
    { inputImageKeys: Array(5).fill(`uploads/${user.id}/ref.png`) },
    { inputImageKeys: [`uploads/${user.id}/ref.png`], inputImageKey: `uploads/${user.id}/legacy.png` },
    { inputImageKeys: [`uploads/${user.id}/ref.png`], sourceImageId: conv },
  ])("rejects invalid or conflicting request %j before inserting", async (patch) => {
    await expect(enqueueGeneration({ user, input: { ...input, ...patch } })).rejects.toMatchObject({ status: 400 });
    expect(mock.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO generations"))).toBe(false);
  });
});
