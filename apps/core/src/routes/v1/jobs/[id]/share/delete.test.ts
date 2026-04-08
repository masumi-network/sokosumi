import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDeleteJobShareById from "./delete";

const {
  authContextState,
  prismaTransactionMock,
  jobFindFirstMock,
  deleteByJobIdMock,
  findWorkspaceForContextMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    } as {
      actor: "user";
      userId: string;
      organizationId: string | null;
    } | null,
  },
  prismaTransactionMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  deleteByJobIdMock: vi.fn(),
  findWorkspaceForContextMock: vi.fn(),
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
  requireUserAuthContext: (authContext: unknown) => authContext,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    findWorkspaceForContext: findWorkspaceForContextMock,
  };
});

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
  const app = new OpenAPIHonoWithAuth({ includeOrganizationHeader: false });
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
    };
    findWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            findFirst: jobFindFirstMock,
          },
        }),
    );
    jobFindFirstMock.mockResolvedValue({
      id: "job_123",
      userId: "user_123",
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
    jobFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(deleteByJobIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the job does not exist", async () => {
    jobFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/job_123/share", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(deleteByJobIdMock).not.toHaveBeenCalled();
  });
});
