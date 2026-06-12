import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listTasksServiceMock = vi.fn();
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

vi.mock("@/lib/services/admin-task.service", () => ({
  adminTaskService: {
    listTasks: (...args: unknown[]) => listTasksServiceMock(...args),
  },
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { AdminAccessRequiredError } from "@/lib/auth/errors";

import { listAdminTasksAction } from "../action";

describe("listAdminTasksAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the task page for an admin session", async () => {
    const page = {
      tasks: [
        {
          id: "task_1",
          name: "Quarterly report",
          status: "RUNNING",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          user: {
            id: "user_1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
          organization: { id: "org_1", name: "Acme Corp", slug: "acme-corp" },
        },
      ],
      total: 1,
      nextCursor: null,
    };
    listTasksServiceMock.mockResolvedValue(page);

    const result = await listAdminTasksAction({ query: "acme", limit: 20 });

    expect(assertAdminSessionMock).toHaveBeenCalled();
    expect(listTasksServiceMock).toHaveBeenCalledWith({
      query: "acme",
      cursor: undefined,
      limit: 20,
    });
    expect(result).toEqual({ ok: true, data: page });
  });

  it("rejects a non-admin session with UNAUTHORIZED", async () => {
    assertAdminSessionMock.mockImplementation(() => {
      throw new AdminAccessRequiredError();
    });

    const result = await listAdminTasksAction({ query: "acme" });

    expect(listTasksServiceMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.UNAUTHORIZED);
    }
  });

  it("maps service failures to INTERNAL_SERVER_ERROR", async () => {
    assertAdminSessionMock.mockImplementation(() => undefined);
    listTasksServiceMock.mockRejectedValue(new Error("core down"));

    const result = await listAdminTasksAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
      expect(result.error.message).toBe("core down");
    }
  });
});
