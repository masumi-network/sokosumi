import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetJobEventsById from "./get";

const { authContextState, jobFindFirstMock, prismaTransactionMock } =
  vi.hoisted(() => ({
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
    jobFindFirstMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
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

vi.mock("@/middleware/workspace", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/middleware/workspace")>();
  return {
    ...actual,
    requireWorkspaceContext: () => ({
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    }),
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  mountGetJobEventsById(app);
  return app;
}

function createJobWithEvents() {
  return {
    id: "job_123",
    workspaceId: "11111111-1111-7111-8111-111111111111",
    events: [
      {
        id: "event_123",
        createdAt: new Date("2026-03-26T10:00:00.000Z"),
        updatedAt: new Date("2026-03-26T10:00:00.000Z"),
        status: "COMPLETED",
        inputSchema: null,
        input: null,
        result: "# Result",
        blobs: [
          {
            id: "blob_123",
            sourceUrl: "https://example.com/source/result.txt",
            name: "result.txt",
            status: "READY",
            mimeType: "text/plain",
            fileUrl: "https://blob.example.com/result.txt",
            size: BigInt(42),
            createdAt: new Date("2026-03-26T10:00:00.000Z"),
            updatedAt: new Date("2026-03-26T10:00:00.000Z"),
          },
        ],
        links: [
          {
            id: "link_123",
            title: "Result doc",
            url: "https://example.com/result",
            createdAt: new Date("2026-03-26T10:00:00.000Z"),
            updatedAt: new Date("2026-03-26T10:00:00.000Z"),
          },
        ],
      },
    ],
  };
}

describe("GET /jobs/{id}/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    };
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback({
          job: {
            findFirst: jobFindFirstMock,
          },
        }),
    );
    jobFindFirstMock.mockResolvedValue(createJobWithEvents());
  });

  it("loads job events with the transaction client and workspace scope", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/job_123/events");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
      include: expect.any(Object),
    });
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "event_123",
        result: "# Result",
        files: [
          expect.objectContaining({
            id: "blob_123",
            jobId: "job_123",
            size: 42,
          }),
        ],
        links: [
          expect.objectContaining({
            id: "link_123",
            jobId: "job_123",
          }),
        ],
      }),
    ]);
  });

  it("returns 404 when the job is outside the active workspace", async () => {
    jobFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/job_123/events");

    expect(response.status).toBe(404);
    // The authorization read (requireJobReadForRouteVars) short-circuits before
    // the include-heavy fetch, so the only query is the workspace-scoped check.
    expect(jobFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "job_123",
        workspaceId: "11111111-1111-7111-8111-111111111111",
      },
    });
  });
});
