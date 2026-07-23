import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutTaskShareById from "./put";

const {
  authContextState,
  prismaTransactionMock,
  requireMutableTaskOwnershipMock,
  upsertForTaskMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    } as
      | {
          actor: "user";
          userId: string;
          organizationId: string | null;
          role: string;
        }
      | {
          actor: "coworker";
          coworkerId: string;
          vendorId: string;
          context: { userId: string; organizationId: string | null };
        }
      | null,
  },
  prismaTransactionMock: vi.fn(),
  requireMutableTaskOwnershipMock: vi.fn(),
  upsertForTaskMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskOwnership: (...args: unknown[]) =>
    requireMutableTaskOwnershipMock(...args),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        req: { path: string; method: string };
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json(
          {
            error: "Unauthorized",
            message: "Unauthorized",
            meta: {
              timestamp: new Date().toISOString(),
              requestId: "req_123",
              path: c.req.path,
              method: c.req.method,
            },
          },
          401,
        );
      }

      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  publicShareRepository: {
    upsertForTask: (...args: unknown[]) => upsertForTaskMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountPutTaskShareById(app);
  return app;
}

describe("PUT /tasks/{id}/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
    );
    requireMutableTaskOwnershipMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_123",
      pendingVendorGrantId: null,
    });
    upsertForTaskMock.mockResolvedValue({
      id: "share_123",
      taskId: "tsk_123",
      token: "public-share-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-03-30T10:00:00.000Z"),
      updatedAt: new Date("2026-03-30T10:00:00.000Z"),
    });
  });

  it("creates a share for an owned task", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(upsertForTaskMock).toHaveBeenCalledWith(
      "tsk_123",
      true,
      expect.any(Object),
    );
    expect(body.data).toMatchObject({
      id: "share_123",
      taskId: "tsk_123",
      token: "public-share-token",
      allowSearchIndexing: true,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    authContextState.current = null;
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(401);
    expect(upsertForTaskMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task is not owned by the caller", async () => {
    const { notFound } = await import("@/helpers/error");
    requireMutableTaskOwnershipMock.mockRejectedValue(
      notFound("Task not found"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(404);
    expect(upsertForTaskMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    const { notFound } = await import("@/helpers/error");
    requireMutableTaskOwnershipMock.mockRejectedValue(
      notFound("Task not found"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(404);
    expect(upsertForTaskMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    };
    const app = createApp();

    const response = await app.request("http://localhost/tsk_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(requireMutableTaskOwnershipMock).not.toHaveBeenCalled();
    expect(upsertForTaskMock).not.toHaveBeenCalled();
  });
});
