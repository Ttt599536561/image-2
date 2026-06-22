// ④b 参考图魔数嗅探单测（审查 #3）：以字节头为权威，挡伪造 Content-Type。
import { describe, expect, it } from "vitest";
import { sniffImageMime } from "./upload";

const b = (...n: number[]) => new Uint8Array(n);

describe("sniffImageMime", () => {
  it("PNG 头 → image/png", () => {
    expect(sniffImageMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });
  it("JPEG 头 → image/jpeg", () => {
    expect(sniffImageMime(b(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("image/jpeg");
  });
  it("WEBP（RIFF….WEBP）→ image/webp", () => {
    // R I F F  <4字节大小>  W E B P
    expect(sniffImageMime(b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(
      "image/webp",
    );
  });
  it("伪造：声明 png 实为文本/HTML 字节 → null（被拒）", () => {
    // "<html>" 起头
    expect(sniffImageMime(b(0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e))).toBeNull();
  });
  it("RIFF 但非 WEBP（如 WAV）→ null", () => {
    expect(sniffImageMime(b(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
  it("空/过短 → null", () => {
    expect(sniffImageMime(b())).toBeNull();
    expect(sniffImageMime(b(0x89, 0x50))).toBeNull();
  });
});
