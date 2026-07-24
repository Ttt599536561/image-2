import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "../../lib/theme";
import { LandingPage, type LandingItem } from "./LandingPage";

const items: LandingItem[] = [
  {
    id: "a",
    cover: "/media/a.png",
    title: "雪山旅人",
    summary: null,
    prompt: "雪山上的旅人，电影感",
    category: "风景",
    width: 1,
    height: 1,
    submitter: null,
  },
  {
    id: "b",
    cover: "/media/b.png",
    title: "赛博猫",
    summary: null,
    prompt: "赛博朋克风格的猫",
    category: null,
    width: 1,
    height: 1,
    submitter: null,
  },
];

function renderLanding(list: LandingItem[] = items) {
  return render(
    <MemoryRouter>
      <ThemeProvider initialTheme="light">
        <LandingPage items={list} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  it("renders hero, magic demo, gallery, capabilities, steps and CTAs", () => {
    renderLanding();

    // 品牌与模型名
    expect(screen.getByText("one-image2")).toBeInTheDocument();
    expect(screen.getByText("由 image-2 模型驱动")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "一句话描述即刻生成你想要的画面",
    );
    // 魔法演示（对话气泡 + 两张图）
    expect(screen.getByText(/黄昏时分的山脉/)).toBeInTheDocument();
    expect(screen.getByText(/把色调改得更冷一些/)).toBeInTheDocument();
    // 画廊（含 hover 提示词文案）
    expect(screen.getByText("雪山旅人")).toBeInTheDocument();
    expect(screen.getByText("赛博猫")).toBeInTheDocument();
    expect(screen.getByText("雪山上的旅人，电影感")).toBeInTheDocument();
    // 三大能力
    expect(screen.getByText("文生图")).toBeInTheDocument();
    expect(screen.getByText("图生图")).toBeInTheDocument();
    expect(screen.getByText("对话式二次编辑")).toBeInTheDocument();
    // 主题切换按钮
    expect(screen.getByRole("button", { name: /切换为深色模式/ })).toBeInTheDocument();
    // CTA 指向注册页（导航 + hero + 底部共 3 处）
    const registerLinks = screen.getAllByRole("link", { name: /免费(注册|开始创作)/ });
    expect(registerLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of registerLinks) {
      expect(link).toHaveAttribute("href", "/register");
    }
  });

  it("hides gallery and magic demo when no items", () => {
    renderLanding([]);
    expect(screen.queryByText("站内用户的真实作品")).not.toBeInTheDocument();
    expect(screen.queryByText("看见魔法发生")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
