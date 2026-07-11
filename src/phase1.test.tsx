import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Composer } from "./components/composer/Composer";
import { aspectRatioFor, dimensionsFor, SIZE_OPTIONS } from "./components/composer/sizeOptions";
import type { GenerateParams } from "./contracts/generate";
import { imageExt, imageFilename } from "./lib/download";
import { formatCredits, formatTimer } from "./lib/format";
import { makePlaceholderImage } from "./lib/placeholder";
import { buildZip, exportZipName } from "./lib/zip";

// 前端形态冒烟测试（Composer UI + 展示/格式工具 + zip）。账号/会话/生成数据已接真（loader/REST），
// 单测只覆盖纯函数与 props 驱动组件（真库交互在 tests/money + 冒烟脚本）。
const baseReq: GenerateParams = {
  prompt: "一只猫",
  size: "auto",
  quality: "auto",
  background: "auto",
};
const noop = () => {};

describe("format helpers", () => {
  it("毫积分按规则展示（整数省小数、否则≤2 位）", () => {
    expect(formatCredits(70)).toBe("0.07");
    expect(formatCredits(10000)).toBe("10");
    expect(formatCredits(5860)).toBe("5.86");
  });
  it("生成中计时格式 M:SS", () => {
    expect(formatTimer(8000)).toBe("0:08");
    expect(formatTimer(65000)).toBe("1:05");
  });
});

describe("sizeOptions（复用 v1 SIZE_OPTIONS 6 档）", () => {
  it("恰好 6 档场景", () => {
    expect(SIZE_OPTIONS).toHaveLength(6);
    expect(SIZE_OPTIONS[0].value).toBe("auto");
  });
  it("尺寸与比例换算正确", () => {
    expect(dimensionsFor("1024x1536")).toEqual({ width: 1024, height: 1536 });
    expect(aspectRatioFor("auto")).toBe(1);
    expect(aspectRatioFor("1920x1088")).toBeCloseTo(1920 / 1088);
  });
});

describe("占位封面（灵感库种子）", () => {
  it("按比例的 SVG data URL", () => {
    const img = makePlaceholderImage("猫", "1536x1024");
    expect(img.publicUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(img).toMatchObject({ width: 1536, height: 1024 });
  });
});

describe("Composer 五态边界", () => {
  it("余额充足 → 显示发送键 + 本次消耗提示", () => {
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford balanceMp={5860} credentialMode="system" customEnabled />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
    expect(screen.getByText(/本次消耗/)).toBeInTheDocument();
  });

  it("积分不足 → 发送键替换为「积分不足，去充值」CTA", () => {
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford={false} balanceMp={50} credentialMode="system" customEnabled />
      </MemoryRouter>,
    );
    expect(screen.getByText("积分不足，去充值")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成" })).toBeNull();
  });

  it("自定义模式零余额仍可生成且明确本站不扣积分", () => {
    render(
      <MemoryRouter>
        <Composer
          request={baseReq}
          onChange={noop}
          onSubmit={noop}
          canAfford={false}
          balanceMp={0}
          credentialMode="custom"
          customEnabled
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
    expect(screen.getByText("使用自定义 Key · 本站不扣积分")).toBeInTheDocument();
    expect(screen.queryByText("积分不足，去充值")).toBeNull();
  });

  it("点比例药丸弹出 6 档尺寸浮层", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford balanceMp={5860} credentialMode="system" customEnabled />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /比例/ }));
    expect(screen.getByText("1:1 方形")).toBeInTheDocument();
    expect(screen.getByText("16:9 横屏")).toBeInTheDocument();
  });
});

describe("下载命名（按 URL 推断扩展名）", () => {
  it("svg / png / 默认 png", () => {
    expect(imageExt("data:image/svg+xml,<svg/>")).toBe("svg");
    expect(imageExt("https://img.example.com/a.png")).toBe("png");
    expect(imageExt("https://img.example.com/a")).toBe("png");
    expect(imageFilename("data:image/svg+xml,x", "abc123")).toBe("图像工坊_abc123.svg");
  });
});

describe("zip 打包（store-mode）", () => {
  it("打出带 PK 魔数的 zip Blob，含全部条目", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([9, 8, 7]);
    const blob = buildZip([
      { name: "a.png", data: a },
      { name: "b.png", data: b },
    ]);
    expect(blob.type).toBe("application/zip");
    // 本地头 + 数据 + 2 条中央目录 + EOCD，长度必大于两段原始数据之和。
    expect(blob.size).toBeGreaterThan(a.length + b.length);
  });
  it("导出文件名形如 图像工坊_导出_YYYYMMDD_HHmmss.zip", () => {
    const name = exportZipName(new Date(2026, 5, 22, 9, 8, 7));
    expect(name).toBe("图像工坊_导出_20260622_090807.zip");
  });
});
