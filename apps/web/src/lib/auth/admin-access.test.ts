import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

import { assertAdminSession } from "./admin-access";
import { AdminAccessRequiredError } from "./errors";

describe("assertAdminSession", () => {
  it("allows sessions with the admin role", () => {
    expect(() =>
      assertAdminSession({
        user: { id: "user-1", role: "admin" },
      } as never),
    ).not.toThrow();
  });

  it("throws AdminAccessRequiredError for non-admin sessions", () => {
    expect(() =>
      assertAdminSession({
        user: { id: "user-1", role: "user" },
      } as never),
    ).toThrow(AdminAccessRequiredError);
  });
});
