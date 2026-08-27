import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listUsersServiceMock = vi.fn();
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
    listUsers: (...args: unknown[]) => listUsersServiceMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import { listAdminUsersAction } from "./action";

describe("listAdminUsersAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the overview page for an admin session", async () => {
    const page = {
      users: [
        {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          credits: 42.5,
          subscriptionPlan: "pro",
          subscriptionStatus: "active",
          startedTaskCount: 7,
        },
      ],
      total: 1,
      nextCursor: null,
    };
    listUsersServiceMock.mockResolvedValue(page);

    const result = await listAdminUsersAction({ query: "ada", limit: 20 });

    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(listUsersServiceMock).toHaveBeenCalledWith({
      query: "ada",
      cursor: undefined,
      limit: 20,
    });
    expect(result).toEqual({ ok: true, value: page });
  });

  it("rejects a non-admin session with UNAUTHORIZED", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await listAdminUsersAction({ query: "ada" });

    expect(listUsersServiceMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("maps service failures to INTERNAL_SERVER_ERROR", async () => {
    assertAdminSessionMock.mockImplementation(() => undefined);
    listUsersServiceMock.mockRejectedValue(new Error("core down"));

    const result = await listAdminUsersAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      expect(result.error.message).toBe("core down");
    }
  });
});
