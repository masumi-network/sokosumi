import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTasksSummary from "./get";

const { sessionAggregateMock, taskCountMock, queryRawMock } = vi.hoisted(
  () => ({
    sessionAggregateMock: vi.fn(),
    taskCountMock: vi.fn(),
    queryRawMock: vi.fn(),
  }),
);

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/middleware/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/workspace")>()),
  requireWorkspaceContext: (
    workspaceContext: WorkspaceVariables["workspaceContext"] | null,
  ) => {
    if (!workspaceContext) {
      throw new HTTPException(400, { message: "Workspace context required" });
    }
    return workspaceContext;
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    session: {
      aggregate: sessionAggregateMock,
    },
    task: {
      count: taskCountMock,
    },
    $queryRaw: queryRawMock,
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const COWORKER_WITH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: {
    userId: "user_123",
    organizationId: "org_123",
  },
};

const ORG_WORKSPACE = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

const PERSONAL_WORKSPACE = {
  workspaceId: "22222222-2222-7222-8222-222222222222",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = ORG_WORKSPACE,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_summary");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });

  mountGetTasksSummary(app);
  return app;
}

async function parseSummary(response: Response) {
  const body = (await response.json()) as {
    data: {
      basis: "lastVisit" | "recent";
      lastVisitAt: string | null;
      since: string;
      completed: number;
      awaitingInput: number;
      createdByOtherHumans: number;
      workedMinutes: number;
    };
  };
  return body.data;
}

describe("GET /tasks/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskCountMock.mockResolvedValue(0);
    queryRawMock.mockResolvedValue([{ seconds: 0 }]);
  });

  it("rejects coworker tokens even when they carry user context", async () => {
    const app = createApp(COWORKER_WITH_CONTEXT);
    const response = await app.request("http://localhost/summary");

    expect(response.status).toBe(403);
    expect(sessionAggregateMock).not.toHaveBeenCalled();
  });

  it("uses lastVisit basis when session activity is at least 30 minutes old", async () => {
    const lastActivity = new Date(Date.now() - 45 * 60 * 1000);
    sessionAggregateMock.mockResolvedValue({
      _max: { updatedAt: lastActivity },
    });
    taskCountMock
      .mockResolvedValueOnce(4) // completed
      .mockResolvedValueOnce(2) // awaiting
      .mockResolvedValueOnce(3); // teammates
    queryRawMock.mockResolvedValue([{ seconds: 47 * 60 }]);

    const app = createApp();
    const response = await app.request(
      "http://localhost/summary?scope=workspace",
    );
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    expect(data.basis).toBe("lastVisit");
    expect(data.lastVisitAt).toBe(lastActivity.toISOString());
    expect(data.since).toBe(lastActivity.toISOString());
    expect(data.completed).toBe(4);
    expect(data.awaitingInput).toBe(2);
    expect(data.createdByOtherHumans).toBe(3);
    expect(data.workedMinutes).toBe(47);

    // completed is windowed; awaiting is not
    expect(taskCountMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: TaskStatus.COMPLETED,
          updatedAt: { gte: lastActivity },
        }),
      }),
    );
    expect(taskCountMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              "GRANT_PENDING",
              "INPUT_REQUIRED",
              "APPROVAL_REQUIRED",
              "AUTHENTICATION_REQUIRED",
              "OUT_OF_CREDITS",
            ],
          },
        }),
      }),
    );
    expect(
      (taskCountMock.mock.calls[1]?.[0] as { where: Record<string, unknown> })
        .where.updatedAt,
    ).toBeUndefined();
  });

  it("falls back to a rolling 24h window when activity is too recent", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    sessionAggregateMock.mockResolvedValue({
      _max: { updatedAt: recent },
    });

    const before = Date.now();
    const app = createApp();
    const response = await app.request("http://localhost/summary");
    const after = Date.now();
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    expect(data.basis).toBe("recent");
    expect(data.lastVisitAt).toBe(recent.toISOString());
    const sinceMs = new Date(data.since).getTime();
    // ~24h ago within test runtime slack
    expect(sinceMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 1000);
  });

  it("falls back to recent when the user has no sessions", async () => {
    sessionAggregateMock.mockResolvedValue({
      _max: { updatedAt: null },
    });

    const app = createApp();
    const response = await app.request("http://localhost/summary");
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    expect(data.basis).toBe("recent");
    expect(data.lastVisitAt).toBeNull();
    expect(data.since).toEqual(expect.any(String));
  });

  it("scopes owned counts to the caller and zeroes teammates in personal workspace", async () => {
    sessionAggregateMock.mockResolvedValue({
      _max: { updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    taskCountMock.mockResolvedValue(1);

    const app = createApp(USER_AUTH_CONTEXT, PERSONAL_WORKSPACE);
    const response = await app.request("http://localhost/summary?scope=owned");
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    expect(data.createdByOtherHumans).toBe(0);
    // completed + awaiting only (no teammates query)
    expect(taskCountMock).toHaveBeenCalledTimes(2);
    expect(taskCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "user_123",
          workspaceId: PERSONAL_WORKSPACE.workspaceId,
        }),
      }),
    );
  });

  it("rounds worked seconds to whole minutes and floors at zero", async () => {
    sessionAggregateMock.mockResolvedValue({
      _max: { updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    queryRawMock.mockResolvedValue([{ seconds: 90.4 }]);

    const app = createApp();
    const response = await app.request("http://localhost/summary");
    const data = await parseSummary(response);
    expect(data.workedMinutes).toBe(2);

    queryRawMock.mockResolvedValue([{ seconds: null }]);
    const responseZero = await app.request("http://localhost/summary");
    const dataZero = await parseSummary(responseZero);
    expect(dataZero.workedMinutes).toBe(0);
  });
});
