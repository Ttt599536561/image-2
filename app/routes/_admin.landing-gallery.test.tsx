// F-073：后台「首页画廊」管理页组件测试 —— 列表渲染（上架/下架/品类）、空态回退提示、新增表单打开。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "./+types/_admin.landing-gallery";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  };
});

import Page from "./_admin.landing-gallery";

const baseItem = {
  id: "33333333-3333-4333-8333-000000000001",
  image: "https://cdn.example.test/media/landing/a.png",
  prompt: "清晨山间薄雾",
  summary: null,
  width: 1536,
  height: 1024,
  sort: 0,
  createdAt: "2026-07-25T08:00:00.000Z",
};

function renderPage(items: unknown[]) {
  const pageProps = {
    loaderData: { data: { items } },
  } as unknown as Route.ComponentProps;
  const router = createMemoryRouter(
    [{ path: "/", element: <Page {...pageProps} /> }],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

describe("admin 首页画廊管理页（F-073）", () => {
  it("渲染列表：标题/品类/上架状态/排序", () => {
    renderPage([
      { ...baseItem, title: "山间晨雾", category: "风景", active: true },
      { ...baseItem, id: "33333333-3333-4333-8333-000000000002", title: "霓虹街角", category: null, active: false, sort: 1 },
    ]);
    expect(screen.getByRole("heading", { name: "首页画廊" })).toBeInTheDocument();
    const fog = screen.getByText("山间晨雾").closest("tr");
    const neon = screen.getByText("霓虹街角").closest("tr");
    expect(fog).not.toBeNull();
    expect(neon).not.toBeNull();
    expect(within(fog as HTMLTableRowElement).getByText("风景")).toBeInTheDocument();
    expect(within(fog as HTMLTableRowElement).getByText("上架")).toBeInTheDocument();
    expect(within(neon as HTMLTableRowElement).getByText("下架")).toBeInTheDocument();
    expect(within(neon as HTMLTableRowElement).getByText("—")).toBeInTheDocument();
  });

  it("空列表 → 提示未配置时回退灵感库", () => {
    renderPage([]);
    expect(screen.getByText(/不配置时首页展示灵感库内容/)).toBeInTheDocument();
  });

  it("说明文案：上架卡按排序展示、无上架卡回退灵感库", () => {
    renderPage([]);
    expect(screen.getByText(/未登录访客打开首页（\/welcome）看到的画廊图片/)).toBeInTheDocument();
  });

  it("点「新增」打开表单（提示词标注可空）", async () => {
    renderPage([]);
    await userEvent.click(screen.getByRole("button", { name: /新增/ }));
    expect(await screen.findByRole("dialog", { name: "新增画廊图" })).toBeInTheDocument();
    expect(screen.getByText("提示词（可空）")).toBeInTheDocument();
    expect(screen.getByText(/本地上传图片，或粘贴公有图片 URL/)).toBeInTheDocument();
  });
});
