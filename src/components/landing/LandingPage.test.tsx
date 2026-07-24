import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LandingPage, type LandingItem } from "./LandingPage";

const items: LandingItem[] = [
  {
    id: "a",
    cover: "/media/a.png",
    title: "雪山旅人",
    summary: null,
    prompt: "p",
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
    prompt: "p",
    category: null,
    width: 1,
    height: 1,
    submitter: null,
  },
];

describe("LandingPage", () => {
  it("renders hero, gallery, capabilities, steps and CTAs", () => {
    render(
      <MemoryRouter>
        <LandingPage items={items} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "一句话描述即刻生成你想要的画面",
    );
    // 真实作品画廊
    expect(screen.getByText("雪山旅人")).toBeInTheDocument();
    expect(screen.getByText("赛博猫")).toBeInTheDocument();
    expect(screen.getByText("风景")).toBeInTheDocument();
    // 三大能力
    expect(screen.getByText("文生图")).toBeInTheDocument();
    expect(screen.getByText("图生图")).toBeInTheDocument();
    expect(screen.getByText("对话式二次编辑")).toBeInTheDocument();
    // CTA 指向注册页（导航 + hero + 底部共 3 处）
    const registerLinks = screen.getAllByRole("link", { name: /免费(注册|开始创作)/ });
    expect(registerLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of registerLinks) {
      expect(link).toHaveAttribute("href", "/register");
    }
  });

  it("renders without gallery when no items", () => {
    render(
      <MemoryRouter>
        <LandingPage items={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("站内用户的真实作品")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
