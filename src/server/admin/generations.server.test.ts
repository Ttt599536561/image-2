import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queries: [] as string[],
  sql: vi.fn(),
}));

vi.mock("../../db/db.server", () => ({
  getSql: () => db.sql,
}));

vi.mock("../r2.server", () => ({
  deleteManyFromR2: vi.fn(),
}));

vi.mock("./audit.server", () => ({
  writeAuditHttp: vi.fn(),
}));

import { listGenerations } from "./generations.server";

describe("listGenerations key mode visibility", () => {
  beforeEach(() => {
    db.queries.length = 0;
    db.sql.mockReset();
    db.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join("?");
      db.queries.push(query);
      if (db.queries.length === 1) {
        return [
          {
            id: "generation-1",
            email: "member@example.test",
            prompt: "雨夜城市",
            size: "1024x1024",
            status: "succeeded",
            error_code: null,
            error: null,
            http_status: 200,
            duration_ms: 12_000,
            created_at: "2026-07-11T08:00:00.000Z",
            thumb_url: "https://images.example.test/generation-1.png",
            credential_mode: "custom",
            credits_charged_mp: "0",
          },
        ];
      }
      return [{ n: 1 }];
    });
  });

  it("returns mode and charged mp without reading the credential table", async () => {
    const result = await listGenerations({ from: "2026-07-01", pageSize: 10 });

    expect(result.items[0]).toMatchObject({
      credentialMode: "custom",
      creditsChargedMp: 0,
    });
    expect(db.queries[0]).toContain("g.credential_mode");
    expect(db.queries[0]).toContain("g.credits_charged_mp");
    expect(db.queries.join("\n")).not.toContain("generation_credentials");
  });
});
