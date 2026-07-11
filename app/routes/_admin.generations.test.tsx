import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "./+types/_admin.generations";

vi.mock("../../src/components/Lightbox/LightboxProvider", () => ({
  useLightbox: () => ({ open: vi.fn(), close: vi.fn() }),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
  };
});

import Page from "./_admin.generations";

const baseGeneration = {
  email: "member@example.test",
  size: "1024x1024",
  status: "succeeded",
  errorCode: null,
  error: null,
  httpStatus: 200,
  durationMs: 10_000,
  createdAt: "2026-07-11T08:00:00.000Z",
  thumbUrl: null,
};

describe("admin generation mode and charge columns", () => {
  it("shows custom zero charge and the actual system charge after size", () => {
    const pageProps = {
      loaderData: {
        data: {
          items: [
            {
              ...baseGeneration,
              id: "custom-generation",
              prompt: "custom prompt",
              credentialMode: "custom",
              creditsChargedMp: 0,
            },
            {
              ...baseGeneration,
              id: "system-generation",
              prompt: "system prompt",
              credentialMode: "system",
              creditsChargedMp: 5_860,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        },
        userEmail: "",
        status: "",
      },
    } as unknown as Route.ComponentProps;
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <Page {...pageProps} />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    const sizeIndex = headers.indexOf("尺寸");
    expect(headers.slice(sizeIndex, sizeIndex + 3)).toEqual(["尺寸", "模式", "扣费"]);

    const customRow = screen.getByText("custom prompt").closest("tr");
    const systemRow = screen.getByText("system prompt").closest("tr");
    expect(customRow).not.toBeNull();
    expect(systemRow).not.toBeNull();
    expect(within(customRow as HTMLTableRowElement).getByText("自定义")).toBeInTheDocument();
    expect(within(customRow as HTMLTableRowElement).getByText("0")).toBeInTheDocument();
    expect(within(systemRow as HTMLTableRowElement).getByText("系统")).toBeInTheDocument();
    expect(within(systemRow as HTMLTableRowElement).getByText("5.86")).toBeInTheDocument();
  });
});
