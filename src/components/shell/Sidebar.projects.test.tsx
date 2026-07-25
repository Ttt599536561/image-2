// Sidebar 项目分组组件测试（F-074）：分组渲染/展开收起持久化/新建/重命名/项目内长按拖动排序。
// api-client 全 mock；路由用 memory router（useRouteLoaderData 无 _app → initialData 缺省走 apiGet）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "../../contracts/me";
import type { ProjectListResponse } from "../../contracts/project";
import { ToastProvider } from "../Toast/ToastProvider";
import { Sidebar } from "./Sidebar";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("../../lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    code = "INTERNAL";
    status = 500;
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiPatch: mocks.apiPatch,
  apiDelete: mocks.apiDelete,
  apiPostForm: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const P_DEFAULT = "00000000-0000-4000-8000-0000000000b1";
const P_WORK = "00000000-0000-4000-8000-0000000000b2";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const C3 = "00000000-0000-4000-8000-0000000000c3";
const NOW = "2026-07-25T00:00:00.000Z";

function meData(): MeResponse {
  return {
    user: { id: USER_ID, email: "projects@example.test", role: "user", createdAt: NOW },
    balanceMp: 1_000,
    maxConcurrency: 2,
    pricePerImageMp: 70,
    hasPaid: true,
    customKeyModesEnabled: true,
    expiringSoon: { mp: "0", nearestExpiresAt: null },
  };
}

function projectsFixture(): ProjectListResponse {
  return {
    items: [
      {
        id: P_DEFAULT,
        name: "默认项目",
        isDefault: true,
        sortOrder: 0,
        conversations: [
          { id: C1, title: "山间小屋", sortOrder: 0, updatedAt: NOW },
          { id: C2, title: "海边落日", sortOrder: 1, updatedAt: NOW },
          { id: C3, title: "城市夜景", sortOrder: 2, updatedAt: NOW },
        ],
      },
      { id: P_WORK, name: "工作", isDefault: false, sortOrder: 1, conversations: [] },
    ],
  };
}

function setupApi(projects: ProjectListResponse = projectsFixture()) {
  mocks.apiGet.mockImplementation(async (url: string) => {
    if (url === "/api/me") return meData();
    if (url === "/api/projects") return projects;
    if (url.startsWith("/api/conversations")) return { items: [], page: 1, pageSize: 20, total: 0 };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/", element: <Sidebar /> }]);
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.apiPatch.mockReset();
  mocks.apiDelete.mockReset();
  mocks.apiPost.mockResolvedValue({ ok: true });
  mocks.apiPatch.mockResolvedValue({ item: null });
  setupApi();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sidebar 项目分组", () => {
  it("默认项目展开显示会话，非默认项目收起；点击项目行切换展开/收起", async () => {
    renderSidebar();
    expect(await screen.findByText("默认项目")).toBeTruthy();
    expect(screen.getByText("山间小屋")).toBeTruthy(); // 默认项目展开
    expect(screen.queryByText("城市夜景")).toBeTruthy();
    // 点击收起
    fireEvent.click(screen.getByText("默认项目"));
    expect(screen.queryByText("山间小屋")).toBeNull();
    expect(JSON.parse(localStorage.getItem(`sidebar.projects.expanded.${USER_ID}`) ?? "{}")).toMatchObject({
      [P_DEFAULT]: false,
    });
    // 再点展开
    fireEvent.click(screen.getByText("默认项目"));
    expect(screen.getByText("山间小屋")).toBeTruthy();
    // 「工作」项目无会话且默认收起
    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.queryByText("项目内暂无会话")).toBeNull();
    fireEvent.click(screen.getByText("工作"));
    expect(screen.getByText("项目内暂无会话")).toBeTruthy();
  });

  it("无项目时显示空态提示", async () => {
    setupApi({ items: [] });
    renderSidebar();
    expect(await screen.findByText("还没有对话，点「新建生成」开始吧")).toBeTruthy();
  });

  it("点 + 弹出新建项目弹窗，保存后新项目置顶并展开", async () => {
    const user = userEvent.setup();
    const newItem = {
      id: "00000000-0000-4000-8000-0000000000b9",
      name: "新项目",
      isDefault: false,
      sortOrder: 0,
      conversations: [],
    };
    mocks.apiPost.mockResolvedValueOnce({ item: newItem });
    renderSidebar();
    await screen.findByText("默认项目");
    fireEvent.click(screen.getAllByLabelText("新建项目")[0]);
    const dialog = await screen.findByRole("dialog", { name: "新建项目" });
    await user.type(dialog.querySelector("input")!, "新项目");
    // onSettled invalidate 会 refetch：让 mock 返回含新项目的数据，断言稳定
    setupApi({
      items: [
        newItem,
        ...projectsFixture().items.map((p) => ({ ...p, sortOrder: p.sortOrder + 1 })),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/projects", { name: "新项目" }, expect.anything()),
    );
    await screen.findByText("新项目");
    expect(screen.getByText("项目内暂无会话")).toBeTruthy(); // 新项目默认展开
  });

  it("… 下拉进入重命名，弹窗预填旧名，保存调用 PATCH", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await screen.findByText("默认项目");
    fireEvent.click(screen.getByLabelText("项目更多操作：默认项目"));
    fireEvent.click(await screen.findByText("重命名项目"));
    const dialog = await screen.findByRole("dialog", { name: "重命名项目" });
    const input = dialog.querySelector("input")!;
    expect((input as HTMLInputElement).value).toBe("默认项目");
    await user.clear(input);
    await user.type(input, "我的项目");
    // onSettled invalidate 会 refetch：让 mock 返回新名，断言稳定
    setupApi({
      items: [
        { ...projectsFixture().items[0], name: "我的项目" },
        projectsFixture().items[1],
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.apiPatch).toHaveBeenCalledWith(
        `/api/projects/${P_DEFAULT}`,
        { name: "我的项目" },
        expect.anything(),
      ),
    );
    await screen.findByText("我的项目");
  });

  it("项目内会话长按拖到末尾，提交整组新顺序", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); // findByText 的 waitFor 依赖真实计时器推进
    renderSidebar();
    const row = (await screen.findByText("山间小屋")).closest("[data-conv-row]") as HTMLElement;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-conv-row]"));
    // jsdom 无布局：手工指定每行 32px 高的矩形（mid 16/48/80）
    rows.forEach((el, i) => {
      el.getBoundingClientRect = () =>
        ({ top: i * 32, height: 32, bottom: i * 32 + 32, left: 0, right: 100, width: 100, x: 0, y: i * 32, toJSON: () => ({}) }) as DOMRect;
    });
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(400); // 超过 350ms 长按阈值进入拖动态
    });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 10, clientY: 90 }); // 越过所有 mid → 末尾
    fireEvent.pointerUp(row, { pointerId: 1 });
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(
        `/api/projects/${P_DEFAULT}/order`,
        { ids: [C2, C3, C1] },
        expect.anything(),
      ),
    );
  });

  it("短按（未到阈值）不触发拖动，保持普通点击导航语义", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSidebar();
    const row = (await screen.findByText("山间小屋")).closest("[data-conv-row]") as HTMLElement;
    fireEvent.pointerDown(row, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(row, { pointerId: 1 });
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });
});
