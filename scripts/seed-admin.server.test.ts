import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("UPDATE users")) return [{ id: "admin-id" }];
    if (query.includes("information_schema.columns")) return [{ exists: 1 }];
    return [];
  });
  const context = {
    password: { hash: vi.fn(async () => "new-password-hash") },
    internalAdapter: {
      findUserByEmail: vi.fn(),
      updatePassword: vi.fn(async () => undefined),
    },
  };
  return {
    sql,
    context,
    signUpEmail: vi.fn(),
    onUserRegistered: vi.fn(async () => undefined),
  };
});

vi.mock("../src/db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("../src/lib/auth", () => ({
  auth: {
    $context: Promise.resolve(mocks.context),
    api: { signUpEmail: mocks.signUpEmail },
  },
}));
vi.mock("../src/lib/auth-hooks", () => ({ onUserRegistered: mocks.onUserRegistered }));

import { seedAdminAccount } from "./seed-admin.server";

describe("seedAdminAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the credential password and repairs business state for an existing auth user", async () => {
    const user = { id: "admin-id", email: "admin@example.com" };
    mocks.context.internalAdapter.findUserByEmail.mockResolvedValue({
      user,
      accounts: [{ providerId: "credential" }],
    });

    await seedAdminAccount("Admin@Example.COM", "replacement-password");

    expect(mocks.signUpEmail).not.toHaveBeenCalled();
    expect(mocks.context.internalAdapter.findUserByEmail).toHaveBeenCalledWith("admin@example.com", {
      includeAccounts: true,
    });
    expect(mocks.context.password.hash).toHaveBeenCalledWith("replacement-password");
    expect(mocks.context.internalAdapter.updatePassword).toHaveBeenCalledWith(
      "admin-id",
      "new-password-hash",
    );
    expect(mocks.onUserRegistered).toHaveBeenCalledWith(user);
  });
});
