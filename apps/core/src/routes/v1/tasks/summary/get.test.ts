import { TaskStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTasksSummary from "./get";

const { taskCountMock, queryRawMock } = vi.hoisted(() => ({
  taskCountMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

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
      since: string;
      completed: number;
      awaitingInput: number;
      createdByOtherHumans: number;
      workedMinutes: number;
      previous: {
        completed: number;
        createdByOtherHumans: number;
        workedMinutes: number;
      };
    };
  };
  return body.data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
    expect(taskCountMock).not.toHaveBeenCalled();
  });

  it("counts the last 24h and the 24h before it", async () => {
    taskCountMock
      .mockResolvedValueOnce(4) // completed
      .mockResolvedValueOnce(2) // awaiting
      .mockResolvedValueOnce(3) // teammates
      .mockResolvedValueOnce(1) // previous completed
      .mockResolvedValueOnce(5); // previous teammates
    queryRawMock
      .mockResolvedValueOnce([{ seconds: 47 * 60 }])
      .mockResolvedValueOnce([{ seconds: 60 * 60 }]);

    const before = Date.now();
    const app = createApp();
    const response = await app.request(
      "http://localhost/summary?scope=workspace",
    );
    const after = Date.now();
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    const sinceMs = new Date(data.since).getTime();
    expect(sinceMs).toBeGreaterThanOrEqual(before - DAY_MS - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - DAY_MS + 1000);
    expect(data).toMatchObject({
      completed: 4,
      awaitingInput: 2,
      createdByOtherHumans: 3,
      workedMinutes: 47,
      previous: {
        completed: 1,
        createdByOtherHumans: 5,
        workedMinutes: 60,
      },
    });

    // completed is windowed [since, now) then [since-24h, since); awaiting is not
    const completedWhere = (n: number) =>
      (taskCountMock.mock.calls[n]?.[0] as { where: Record<string, unknown> })
        .where;
    expect(completedWhere(0)).toMatchObject({ status: TaskStatus.COMPLETED });
    const cur = completedWhere(0).updatedAt as { gte: Date; lt: Date };
    const prev = completedWhere(3).updatedAt as { gte: Date; lt: Date };
    expect(cur.gte.getTime()).toBe(sinceMs);
    expect(prev.lt.getTime()).toBe(sinceMs);
    expect(prev.gte.getTime()).toBe(sinceMs - DAY_MS);
    expect(completedWhere(1).status).toEqual({
      in: [
        "GRANT_PENDING",
        "INPUT_REQUIRED",
        "APPROVAL_REQUIRED",
        "AUTHENTICATION_REQUIRED",
        "OUT_OF_CREDITS",
      ],
    });
    expect(completedWhere(1).updatedAt).toBeUndefined();
    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("scopes owned counts to the caller and zeroes teammates in personal workspace", async () => {
    taskCountMock.mockResolvedValue(1);

    const app = createApp(USER_AUTH_CONTEXT, PERSONAL_WORKSPACE);
    const response = await app.request("http://localhost/summary?scope=owned");
    expect(response.status).toBe(200);

    const data = await parseSummary(response);
    expect(data.createdByOtherHumans).toBe(0);
    // completed + awaiting + previous completed (no teammates queries)
    expect(taskCountMock).toHaveBeenCalledTimes(3);
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
