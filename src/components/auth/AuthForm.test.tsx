import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm";

vi.mock("../../lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
    getSession: vi.fn(),
  },
}));

describe("AuthForm hydration guard", () => {
  it("keeps native submission disabled during SSR and enables it after hydration", async () => {
    const html = renderToString(
      <MemoryRouter>
        <AuthForm mode="register" />
      </MemoryRouter>,
    );
    expect(html).toContain('data-auth-ready="false"');
    expect(html).toContain("disabled");

    render(
      <MemoryRouter>
        <AuthForm mode="register" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "注册" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "注册" })).toHaveAttribute(
      "data-auth-ready",
      "true",
    );
  });
});
