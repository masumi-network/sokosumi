import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutJobShareById from "./put";

const {
  authContextState,
  prismaTransactionMock,
  upsertForJobMock,
  requireMutableJobOwnershipMock,
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
      | {
          actor: "sokoBot";
          sokoBotId: string;
          userId: string;
          workspaceId: string;
          organizationId: string | null;
        }
      | null,
  },
  prismaTransactionMock: vi.fn(),
  upsertForJobMock: vi.fn(),
  requireMutableJobOwnershipMock: vi.fn(),
}));

vi.mock("@/helpers/access-control.js", () => ({
  requireMutableJobOwnership: (...args: unknown[]) =>
    requireMutableJobOwnershipMock(...args),
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
    upsertForJob: (...args: unknown[]) => upsertForJobMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountPutJobShareById(app);
  return app;
}

describe("PUT /jobs/{id}/share", () => {
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
    requireMutableJobOwnershipMock.mockResolvedValue({
      id: "job_123",
      userId: "user_123",
      taskId: null,
    });
    upsertForJobMock.mockResolvedValue({
      id: "share_123",
      jobId: "job_123",
      token: "public-share-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-03-26T10:00:00.000Z"),
      updatedAt: new Date("2026-03-26T10:00:00.000Z"),
    });
  });

  it("creates a share for an owned job", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
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
    expect(requireMutableJobOwnershipMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_123" }),
      "job_123",
      expect.any(Object),
    );
    expect(upsertForJobMock).toHaveBeenCalledWith(
      "job_123",
      true,
      expect.any(Object),
    );
    expect(body.data).toMatchObject({
      id: "share_123",
      jobId: "job_123",
      token: "public-share-token",
      allowSearchIndexing: true,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    authContextState.current = null;
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(401);
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job is owned by another user", async () => {
    requireMutableJobOwnershipMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job does not exist (no existence leak)", async () => {
    requireMutableJobOwnershipMock.mockRejectedValueOnce(
      forbidden("You can only access your own jobs"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker context even when X-Context-User-Id matches owner", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "01960001-0001-7001-8001-000000000001",
      context: { userId: "user_123", organizationId: "org_123" },
    };
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(requireMutableJobOwnershipMock).not.toHaveBeenCalled();
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });
  it("returns 403 for soko bot authentication acting as the owner", async () => {
    authContextState.current = {
      actor: "sokoBot",
      sokoBotId: "bot_123",
      userId: "user_123",
      workspaceId: "ws_123",
      organizationId: "org_123",
    };
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        allowSearchIndexing: true,
      }),
    });

    expect(response.status).toBe(403);
    expect(requireMutableJobOwnershipMock).not.toHaveBeenCalled();
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });
});
