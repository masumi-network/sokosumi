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
import { hasAdminRole } from "./has-admin-role";

describe("hasAdminRole", () => {
  it("returns true when role contains admin", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("user,admin")).toBe(true);
    expect(hasAdminRole("ADMIN")).toBe(true);
    expect(hasAdminRole(" user , admin ")).toBe(true);
  });

  it("returns false for non-admin roles", () => {
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole("")).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole("administrator")).toBe(false);
  });
});

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
