import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPutJobShareById from "./put";

const {
  authContextState,
  prismaTransactionMock,
  jobFindUniqueMock,
  upsertForJobMock,
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
  jobFindUniqueMock: vi.fn(),
  upsertForJobMock: vi.fn(),
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
  const app = new OpenAPIHonoWithAuth({ includeOrganizationHeader: false });
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
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            findUnique: jobFindUniqueMock,
          },
        }),
    );
    jobFindUniqueMock.mockResolvedValue({
      id: "job_123",
      userId: "user_123",
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
    jobFindUniqueMock.mockResolvedValue({
      id: "job_123",
      userId: "other_user",
    });
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

  it("returns 404 when the job does not exist", async () => {
    jobFindUniqueMock.mockResolvedValue(null);
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

    expect(response.status).toBe(404);
    expect(upsertForJobMock).not.toHaveBeenCalled();
  });
});
