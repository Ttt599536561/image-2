import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Composer } from "./components/composer/Composer";
import {
  aspectRatioFor,
  dimensionsFor,
  SIZE_OPTIONS,
} from "./components/composer/sizeOptions";
import type { GenerateRequest } from "./contracts/generate";
import { formatCredits, formatTimer } from "./lib/format";
import { mockGenerate } from "./mocks/api";
import { makePlaceholderImage } from "./mocks/images";

// 阶段一前端形态冒烟测试（替代 v1 App.test.tsx，对齐新 Composer UI）。
const baseReq: GenerateRequest = {
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

describe("mock 生成（镜像真契约）", () => {
  it("占位成品图为按比例的 SVG data URL", () => {
    const img = makePlaceholderImage("猫", "1536x1024");
    expect(img.publicUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(img).toMatchObject({ width: 1536, height: 1024 });
  });
  it("提交返回 202 queued + generationId", async () => {
    const r = await mockGenerate(baseReq);
    expect(r.status).toBe("queued");
    expect(typeof r.generationId).toBe("string");
    expect(r.generationId.length).toBeGreaterThan(0);
  });
});

describe("Composer 五态边界", () => {
  it("余额充足 → 显示发送键 + 本次消耗提示", () => {
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford balanceMp={5860} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
    expect(screen.getByText(/本次消耗/)).toBeInTheDocument();
  });

  it("积分不足 → 发送键替换为「积分不足，去充值」CTA", () => {
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford={false} balanceMp={50} />
      </MemoryRouter>,
    );
    expect(screen.getByText("积分不足，去充值")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成" })).toBeNull();
  });

  it("点比例药丸弹出 6 档尺寸浮层", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Composer request={baseReq} onChange={noop} onSubmit={noop} canAfford balanceMp={5860} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /比例/ }));
    expect(screen.getByText("1:1 方形")).toBeInTheDocument();
    expect(screen.getByText("16:9 横屏")).toBeInTheDocument();
  });
});
