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
    } as {
      actor: "user";
      userId: string;
      organizationId: string | null;
      role: string;
    } | null,
  },
  prismaTransactionMock: vi.fn(),
  requireMutableTaskOwnershipMock: vi.fn(),
  upsertForTaskMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireMutableTaskOwnership: (...args: unknown[]) =>
    requireMutableTaskOwnershipMock(...args),
}));

vi.mock("@/middleware/auth", () => ({
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
  requireUserContext: (authContext: unknown) => {
    const a = authContext as {
      actor: string;
      userId: string;
      organizationId: string | null;
      role: string;
      context?: { userId: string; organizationId: string | null };
    };
    if (a.actor === "user") {
      return {
        source: "session" as const,
        actor: "user",
        userId: a.userId,
        organizationId: a.organizationId,
        role: a.role,
      };
    }
    if (a.actor === "coworker" && a.context) {
      return {
        source: "context" as const,
        userId: a.context.userId,
        organizationId: a.context.organizationId,
      };
    }
    throw new Error("mock requireUserContext: unsupported auth context");
  },
  isUserAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "user",
  isCoworkerAuthContext: (authContext: { actor: string }) =>
    authContext.actor === "coworker",
}));

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
      userId: "user_123",
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
});
