import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteJobShareById from "./delete";

const {
  authContextState,
  prismaTransactionMock,
  deleteByJobIdMock,
  requireJobCollaborationMock,
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
  deleteByJobIdMock: vi.fn(),
  requireJobCollaborationMock: vi.fn(),
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireJobCollaboration: requireJobCollaborationMock,
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
    deleteByJobId: (...args: unknown[]) => deleteByJobIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountDeleteJobShareById(app);
  return app;
}

describe("DELETE /jobs/{id}/share", () => {
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
    requireJobCollaborationMock.mockResolvedValue({
      id: "job_123",
      userId: "user_123",
      taskId: null,
    });
    deleteByJobIdMock.mockResolvedValue({ count: 1 });
  });

  it("deletes the share for an owned job", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteByJobIdMock).toHaveBeenCalledWith(
      "job_123",
      expect.any(Object),
    );
    expect(body.data).toEqual({});
  });

  it("returns 401 for unauthenticated requests", async () => {
    authContextState.current = null;
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });

    expect(response.status).toBe(401);
    expect(deleteByJobIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job is owned by another user", async () => {
    requireJobCollaborationMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(deleteByJobIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job does not exist (no existence leak)", async () => {
    requireJobCollaborationMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(deleteByJobIdMock).not.toHaveBeenCalled();
  });
});
