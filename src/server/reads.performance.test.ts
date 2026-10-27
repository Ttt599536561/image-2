// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("../db/db.server", () => ({ getSql: () => db.sql }));
import { loadMe } from "./reads.server";
import { loadDashboard } from "./admin/dashboard.server";

const user = {
  id: "user-1", email: "user@example.test", role: "user", max_concurrency: 2,
  has_paid: true, created_at: "2026-10-27T00:00:00Z", balance_mp: "1234567890",
  expiring_mp: "9007199254740993", nearest_expires_at: "2026-10-28T00:00:00Z",
  price_config_key: "price_per_image_mp", price_value_json: "82",
};

beforeEach(() => db.sql.mockReset());

describe("loadMe read efficiency", () => {
  it("returns account, expiry and current price in one owner-scoped round trip", async () => {
    db.sql.mockResolvedValue([user]);
    const result = await loadMe(user.id);
    expect(db.sql).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      user: { id: user.id, email: user.email, createdAt: "2026-10-27T00:00:00.000Z" },
      balanceMp: 1234567890, maxConcurrency: 2, hasPaid: true, pricePerImageMp: 82,
      expiringSoon: { mp: "9007199254740993", nearestExpiresAt: "2026-10-28T00:00:00.000Z" },
    });
    const [parts, ...params] = db.sql.mock.calls[0];
    expect(parts.join("?")).toMatch(/u\.id\s*=\s*\?/);
    expect(parts.join("?")).toMatch(/remaining_mp\s*>\s*0/);
    expect(parts.join("?")).toContain("interval '3 days'");
    expect(params).toContain(user.id);
  });

  it("sees changed price on the very next request without a cache", async () => {
    db.sql.mockResolvedValue([user]);
    db.sql.mockResolvedValueOnce([{ ...user, price_value_json: 70 }]);
    db.sql.mockResolvedValueOnce([{ ...user, price_value_json: 91 }]);
    expect((await loadMe(user.id)).pricePerImageMp).toBe(70);
    expect((await loadMe(user.id)).pricePerImageMp).toBe(91);
    expect(db.sql).toHaveBeenCalledTimes(2);
  });

  it.each([
    [null, null, 70], ["price_per_image_mp", "invalid", 70],
    ["price_per_image_mp", null, 0], ["price_per_image_mp", 0, 0],
    ["price_per_image_mp", "Infinity", 70],
    ["price_per_image_mp", false, 0], ["price_per_image_mp", true, 1],
    ["price_per_image_mp", [], 0], ["price_per_image_mp", [82], 82],
    ["price_per_image_mp", [70, 82], 70], ["price_per_image_mp", {}, 70],
  ])("preserves config conversion for %s / %s", async (key, value, expected) => {
    db.sql.mockResolvedValue([{ ...user, price_config_key: key, price_value_json: value,
      expiring_mp: "0", nearest_expires_at: null }]);
    const result = await loadMe(user.id);
    expect(result.pricePerImageMp).toBe(expected);
    expect(result.expiringSoon).toEqual({ mp: "0", nearestExpiresAt: null });
    expect(db.sql).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a missing user", async () => {
    db.sql.mockResolvedValue([]);
    await expect(loadMe("missing")).rejects.toMatchObject({ status: 404 });
    expect(db.sql).toHaveBeenCalledTimes(1);
  });
});

it("restricts dashboard queue aggregation to active statuses before counting", async () => {
  db.sql.mockResolvedValue([]);
  const result = await loadDashboard();
  const queueQuery = db.sql.mock.calls.map(([parts]) => parts.join("?"))
    .find((query: string) => query.includes("AS queued"));
  expect(queueQuery).toMatch(/FROM generations\s+WHERE status IN \('queued',\s*'claimed',\s*'running'\)/);
  expect(result.queueQueued).toBe(0);
  expect(result.queueRunning).toBe(0);
});
