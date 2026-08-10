import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const searchUsersServiceMock = vi.fn();
const searchOrganizationsServiceMock = vi.fn();
const assertAdminSessionMock = vi.fn();

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  assertAdminSession: (...args: unknown[]) => assertAdminSessionMock(...args),
}));

vi.mock("@/lib/services/admin-user.service", () => ({
  adminUserService: {
    searchUsers: (...args: unknown[]) => searchUsersServiceMock(...args),
  },
}));

vi.mock("@/lib/services/admin-organization.service", () => ({
  adminOrganizationService: {
    searchOrganizations: (...args: unknown[]) =>
      searchOrganizationsServiceMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import { searchOrganizationsAction, searchUsersAction } from "../action";

describe("admin search actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user results for an admin session", async () => {
    searchUsersServiceMock.mockResolvedValue([
      { id: "u1", name: "Ada", email: "ada@example.com" },
    ]);

    const result = await searchUsersAction({ query: "ada" });

    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(searchUsersServiceMock).toHaveBeenCalledWith("ada");
    expect(result).toEqual({
      ok: true,
      value: [{ id: "u1", name: "Ada", email: "ada@example.com" }],
    });
  });

  it("returns organization results for an admin session", async () => {
    searchOrganizationsServiceMock.mockResolvedValue([
      { id: "o1", name: "Acme", slug: "acme" },
    ]);

    const result = await searchOrganizationsAction({ query: "acme" });

    expect(searchOrganizationsServiceMock).toHaveBeenCalledWith("acme");
    expect(result).toEqual({
      ok: true,
      value: [{ id: "o1", name: "Acme", slug: "acme" }],
    });
  });

  it("rejects a non-admin session with UNAUTHORIZED (users)", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await searchUsersAction({ query: "ada" });

    expect(searchUsersServiceMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("rejects a non-admin session with UNAUTHORIZED (organizations)", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await searchOrganizationsAction({ query: "acme" });

    expect(searchOrganizationsServiceMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });
});
