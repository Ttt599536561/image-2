// projects.server 单测：读形状 / 默认项目懒创建并发回读 / 整组重排集合校验。
// getSql 与 tx 全 mock，不碰真库（对齐 generations.server.test.ts 范式）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  sql: vi.fn(),
  txQuery: vi.fn(),
}));

vi.mock("../db/db.server", () => ({
  getSql: () => db.sql,
}));

vi.mock("./tx.server", () => ({
  tx: async (fn: (c: { query: typeof db.txQuery }) => Promise<unknown>) => fn({ query: db.txQuery }),
}));

import {
  createProject,
  ensureDefaultProject,
  loadProjects,
  renameProject,
  reorderProjectConversations,
  reorderProjects,
} from "./projects.server";

const USER = "00000000-0000-4000-8000-0000000000a1";
const P1 = "00000000-0000-4000-8000-0000000000b1";
const P2 = "00000000-0000-4000-8000-0000000000b2";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";

beforeEach(() => {
  db.sql.mockReset();
  db.txQuery.mockReset();
  db.txQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

describe("loadProjects", () => {
  it("无项目返回空列表，不查会话", async () => {
    db.sql.mockResolvedValueOnce([]);
    const res = await loadProjects(USER);
    expect(res).toEqual({ items: [] });
    expect(db.sql).toHaveBeenCalledTimes(1);
  });

  it("项目按 sort_order 分组承载各自会话", async () => {
    db.sql.mockResolvedValueOnce([
      { id: P1, name: "默认项目", is_default: true, sort_order: 0 },
      { id: P2, name: "工作", is_default: false, sort_order: 1 },
    ]);
    db.sql.mockResolvedValueOnce([
      { id: C1, project_id: P1, title: "猫", sort_order: 0, updated_at: "2026-07-25T00:00:00Z" },
      { id: C2, project_id: P1, title: "狗", sort_order: 1, updated_at: "2026-07-24T00:00:00Z" },
    ]);
    const res = await loadProjects(USER);
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({ id: P1, name: "默认项目", isDefault: true, sortOrder: 0 });
    expect(res.items[0].conversations.map((c) => c.id)).toEqual([C1, C2]);
    expect(res.items[1].conversations).toEqual([]);
  });
});

describe("ensureDefaultProject", () => {
  it("插入成功返回新 id", async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: P1 }], rowCount: 1 }) };
    await expect(ensureDefaultProject(c as never, USER)).resolves.toBe(P1);
  });

  it("并发冲突（rowCount=0）回读胜者行", async () => {
    const c = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: P2 }], rowCount: 1 }),
    };
    await expect(ensureDefaultProject(c as never, USER)).resolves.toBe(P2);
    expect(c.query).toHaveBeenCalledTimes(2);
  });
});

describe("createProject", () => {
  it("同事务先整体 +1 再置顶插入", async () => {
    db.txQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 2 }) // UPDATE shift
      .mockResolvedValueOnce({ rows: [{ id: P1 }], rowCount: 1 }); // INSERT
    db.sql.mockResolvedValueOnce([{ id: P1, name: "新项目", is_default: false, sort_order: 0 }]); // loadProjects
    db.sql.mockResolvedValueOnce([]); // conversations
    const res = await createProject(USER, "新项目");
    expect(res.item).toMatchObject({ id: P1, name: "新项目" });
    const shift = db.txQuery.mock.calls[0][0] as string;
    const insert = db.txQuery.mock.calls[1][0] as string;
    expect(shift).toContain("sort_order = sort_order + 1");
    expect(insert).toContain("INSERT INTO projects");
  });
});

describe("renameProject", () => {
  it("owner 不命中返回 null", async () => {
    db.sql.mockResolvedValueOnce([]); // UPDATE ... RETURNING 空
    await expect(renameProject(USER, P1, "x")).resolves.toBeNull();
  });

  it("命中后返回更新项", async () => {
    db.sql.mockResolvedValueOnce([{ id: P1 }]);
    db.sql.mockResolvedValueOnce([{ id: P1, name: "改名", is_default: true, sort_order: 0 }]);
    db.sql.mockResolvedValueOnce([]);
    const res = await renameProject(USER, P1, "改名");
    expect(res?.item.name).toBe("改名");
  });
});

describe("reorderProjects", () => {
  it("集合不一致（少/多/含他人）拒绝且不进事务", async () => {
    db.sql.mockResolvedValue([{ id: P1 }, { id: P2 }]);
    await expect(reorderProjects(USER, [P1])).resolves.toBe(false);
    await expect(reorderProjects(USER, [P2, P1, P1])).resolves.toBe(false);
    await expect(reorderProjects(USER, [P1, C1])).resolves.toBe(false);
    expect(db.txQuery).not.toHaveBeenCalled();
  });

  it("集合一致按数组顺序重写 0..n-1", async () => {
    db.sql.mockResolvedValueOnce([{ id: P1 }, { id: P2 }]);
    await expect(reorderProjects(USER, [P2, P1])).resolves.toBe(true);
    expect(db.txQuery).toHaveBeenCalledTimes(2);
    expect(db.txQuery.mock.calls[0][1]).toEqual([0, P2, USER]);
    expect(db.txQuery.mock.calls[1][1]).toEqual([1, P1, USER]);
  });
});

describe("reorderProjectConversations", () => {
  it("项目不属于本人直接拒绝", async () => {
    db.sql.mockResolvedValueOnce([]); // projects 查无
    await expect(reorderProjectConversations(USER, P1, [C1])).resolves.toBe(false);
  });

  it("会话集合不一致拒绝", async () => {
    db.sql.mockResolvedValueOnce([{ id: P1 }]);
    db.sql.mockResolvedValueOnce([{ id: C1 }, { id: C2 }]);
    await expect(reorderProjectConversations(USER, P1, [C1])).resolves.toBe(false);
  });

  it("集合一致按数组顺序重写", async () => {
    db.sql.mockResolvedValueOnce([{ id: P1 }]);
    db.sql.mockResolvedValueOnce([{ id: C1 }, { id: C2 }]);
    await expect(reorderProjectConversations(USER, P1, [C2, C1])).resolves.toBe(true);
    expect(db.txQuery).toHaveBeenCalledTimes(2);
    expect(db.txQuery.mock.calls[0][1]).toEqual([0, C2, P1, USER]);
    expect(db.txQuery.mock.calls[1][1]).toEqual([1, C1, P1, USER]);
  });
});
