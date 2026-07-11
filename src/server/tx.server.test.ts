import { beforeEach, describe, expect, it, vi } from "vitest";

const client = {
  query: vi.fn(),
  release: vi.fn(),
};
const pool = {
  connect: vi.fn(async () => client),
  end: vi.fn(),
};

vi.mock("../db/db.server", () => ({ getPool: () => pool }));

import { tx } from "./tx.server";

describe("tx persistent pool lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("releases the client without ending the process pool", async () => {
    await expect(tx(async () => "ok")).resolves.toBe("ok");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).not.toHaveBeenCalled();
  });
});
