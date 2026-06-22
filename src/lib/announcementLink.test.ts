import { describe, expect, it } from "vitest";
import { classifyAnnouncementLink } from "./announcementLink";

// §9 广播公告 link 安全分类（前后端单一真相源）。重点锁定开放重定向 / 伪协议绕过被拒。
describe("classifyAnnouncementLink", () => {
  it("放行站内单层路径", () => {
    expect(classifyAnnouncementLink("/")).toBe("internal"); // 根路径，同源安全
    expect(classifyAnnouncementLink("/billing")).toBe("internal");
    expect(classifyAnnouncementLink("/assets?range=7d")).toBe("internal");
    expect(classifyAnnouncementLink("/c/abc-123")).toBe("internal");
  });

  it("放行 http(s) 外链（含大小写）", () => {
    expect(classifyAnnouncementLink("https://example.com")).toBe("external");
    expect(classifyAnnouncementLink("http://example.com/x")).toBe("external");
    expect(classifyAnnouncementLink("HTTPS://EXAMPLE.COM")).toBe("external");
  });

  it("拒绝开放重定向：协议相对 // 与反斜杠 /\\evil（浏览器规整为 //）", () => {
    expect(classifyAnnouncementLink("//evil.com")).toBe(null);
    expect(classifyAnnouncementLink("/\\evil.com")).toBe(null);
    expect(classifyAnnouncementLink("/\\\\evil.com")).toBe(null);
    expect(classifyAnnouncementLink("\\\\evil.com")).toBe(null);
    expect(classifyAnnouncementLink("/path\\to")).toBe(null); // 任意位置含反斜杠即拒
  });

  it("拒绝伪协议与非 http(s)", () => {
    expect(classifyAnnouncementLink("javascript:alert(1)")).toBe(null);
    expect(classifyAnnouncementLink("JavaScript:alert(1)")).toBe(null);
    expect(classifyAnnouncementLink("data:text/html,x")).toBe(null);
    expect(classifyAnnouncementLink("vbscript:x")).toBe(null);
    expect(classifyAnnouncementLink("https:/evil.com")).toBe(null); // 缺一斜杠 → 既非内部也非 http(s)
    expect(classifyAnnouncementLink("ftp://example.com")).toBe(null);
  });

  it("拒绝空 / 非 / 开头的相对串", () => {
    expect(classifyAnnouncementLink("")).toBe(null);
    expect(classifyAnnouncementLink("billing")).toBe(null);
    expect(classifyAnnouncementLink(" /billing")).toBe(null); // 前导空白 → 调用方应先 trim
  });
});
