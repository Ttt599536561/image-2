import { describe, expect, it } from "vitest";
import {
  dayInBounds,
  dayStr,
  expiringInDays,
  fmtDay,
  monthGrid,
  parseDay,
  rangeState,
  rectsIntersect,
  stepMonth,
} from "./assetsSelection";

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

describe("parseDay / fmtDay", () => {
  it("解析合法日期", () => expect(parseDay("2026-06-22")).toEqual({ y: 2026, m: 6, d: 22 }));
  it("非法 → null", () => {
    expect(parseDay("")).toBeNull();
    expect(parseDay("2026-6-2")).toBeNull();
    expect(parseDay("2026/06/22")).toBeNull();
  });
  it("fmtDay 补零", () => expect(fmtDay(2026, 1, 5)).toBe("2026-01-05"));
});

describe("monthGrid", () => {
  it("2026-06（6月1日是周一）→ 前置 1 个 null，长度补足 7 的倍数", () => {
    const g = monthGrid(2026, 6);
    expect(g[0]).toBeNull(); // 周日空
    expect(g[1]).toBe("2026-06-01"); // 周一
    expect(g.filter((c) => c !== null)).toHaveLength(30); // 6 月 30 天
    expect(g.length % 7).toBe(0);
  });
  it("2026-02（非闰年）→ 28 天", () => {
    expect(monthGrid(2026, 2).filter((c) => c !== null)).toHaveLength(28);
  });
});

describe("stepMonth", () => {
  it("跨年 +1", () => expect(stepMonth(2026, 12, 1)).toEqual({ year: 2027, month1: 1 }));
  it("跨年 -1", () => expect(stepMonth(2026, 1, -1)).toEqual({ year: 2025, month1: 12 }));
  it("同年 +3", () => expect(stepMonth(2026, 6, 3)).toEqual({ year: 2026, month1: 9 }));
});

describe("dayInBounds", () => {
  it("无界 → true", () => expect(dayInBounds("2026-06-22")).toBe(true));
  it("低于下界 → false", () => expect(dayInBounds("2026-06-01", "2026-06-10")).toBe(false));
  it("高于上界 → false", () => expect(dayInBounds("2026-06-30", undefined, "2026-06-22")).toBe(false));
  it("界内（含边界）→ true", () => {
    expect(dayInBounds("2026-06-10", "2026-06-10", "2026-06-22")).toBe(true);
    expect(dayInBounds("2026-06-22", "2026-06-10", "2026-06-22")).toBe(true);
  });
});

describe("rangeState", () => {
  it("起点 / 终点 / 区间内 / 区间外", () => {
    expect(rangeState("2026-06-10", "2026-06-10", "2026-06-20")).toBe("start");
    expect(rangeState("2026-06-20", "2026-06-10", "2026-06-20")).toBe("end");
    expect(rangeState("2026-06-15", "2026-06-10", "2026-06-20")).toBe("in");
    expect(rangeState("2026-06-25", "2026-06-10", "2026-06-20")).toBe("none");
  });
  it("仅起点（无终点）→ 该日 start，其余 none", () => {
    expect(rangeState("2026-06-10", "2026-06-10", "")).toBe("start");
    expect(rangeState("2026-06-15", "2026-06-10", "")).toBe("none");
  });
});
