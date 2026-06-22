import { describe, expect, it } from "vitest";
import { dayStr, expiringInDays, rectsIntersect } from "./assetsSelection";

describe("rectsIntersect", () => {
  const box = { left: 0, top: 0, right: 100, bottom: 100 };
  it("相交 → true", () => {
    expect(rectsIntersect({ left: 50, top: 50, right: 150, bottom: 150 }, box)).toBe(true);
  });
  it("完全包含 → true", () => {
    expect(rectsIntersect({ left: 10, top: 10, right: 20, bottom: 20 }, box)).toBe(true);
  });
  it("边缘相切 → true", () => {
    expect(rectsIntersect({ left: 100, top: 0, right: 200, bottom: 100 }, box)).toBe(true);
  });
  it("完全分离（右侧）→ false", () => {
    expect(rectsIntersect({ left: 101, top: 0, right: 200, bottom: 100 }, box)).toBe(false);
  });
  it("完全分离（下方）→ false", () => {
    expect(rectsIntersect({ left: 0, top: 101, right: 100, bottom: 200 }, box)).toBe(false);
  });
});

describe("expiringInDays", () => {
  const now = Date.parse("2026-06-22T12:00:00Z");
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();
  it("无到期 → null", () => expect(expiringInDays(null, now)).toBeNull());
  it("已过期 → null", () => expect(expiringInDays(inDays(-1), now)).toBeNull());
  it("剩 >3 天 → null", () => expect(expiringInDays(inDays(5), now)).toBeNull());
  it("剩 3 天整 → 3", () => expect(expiringInDays(inDays(3), now)).toBe(3));
  it("剩 2.5 天 → 向上取整 3", () => expect(expiringInDays(inDays(2.5), now)).toBe(3));
  it("剩 1 天 → 1", () => expect(expiringInDays(inDays(1), now)).toBe(1));
  it("剩几小时 → 向上取整 1", () => expect(expiringInDays(inDays(0.2), now)).toBe(1));
  it("恰好临界 3 天边界外（3.01 天）→ null", () => expect(expiringInDays(inDays(3.01), now)).toBeNull());
});

describe("dayStr", () => {
  it("补零格式 YYYY-MM-DD", () => {
    expect(dayStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayStr(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
