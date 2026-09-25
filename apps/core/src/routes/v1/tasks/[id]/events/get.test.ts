import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetTaskEvents from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  prismaTransactionMock,
  requireTaskReadForRouteVarsMock,
  taskEventCountMock,
  taskEventFindFirstMock,
  taskEventFindManyMock,
} = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
  taskEventCountMock: vi.fn(),
  taskEventFindFirstMock: vi.fn(),
  taskEventFindManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    taskEvent: {
      count: taskEventCountMock,
      findFirst: taskEventFindFirstMock,
      findMany: taskEventFindManyMock,
    },
  },
}));

const testWorkspaceId = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: testWorkspaceId,
      userId: null,
      organizationId: "org_123",
    });
    c.set("requestId", "req_123");
    return await next();
  });

  mountGetTaskEvents(app);
  return app;
}

function makeEvent(overrides: {
  id: string;
  createdAt: string;
  comment?: string | null;
}) {
  return {
    id: overrides.id,
    taskId: "tsk_123",
    createdAt: new Date(overrides.createdAt),
    updatedAt: new Date(overrides.createdAt),
    status: null,
    comment: overrides.comment ?? null,
    cents: null,
    authenticationUrl: null,
    channel: "SOKOSUMI",
    userId: null,
    coworkerId: null,
    sokoBotId: null,
    transactionId: null,
    user: null,
    coworker: null,
    sokoBot: null,
    transaction: null,
  };
}

describe("GET /tasks/{id}/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadForRouteVarsMock.mockResolvedValue({ id: "tsk_123" });
    taskEventFindFirstMock.mockResolvedValue(null);
    taskEventFindManyMock.mockResolvedValue([]);
    taskEventCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(async (operations) => {
      return await Promise.all(operations);
    });
  });

  it("gates access with requireTaskReadForRouteVars before listing", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/tsk_123/events");

    expect(response.status).toBe(200);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authContext: expect.objectContaining({ userId: "user_123" }),
        workspaceContext: expect.objectContaining({
          workspaceId: testWorkspaceId,
        }),
      }),
      "tsk_123",
      expect.any(Object),
    );
  });

  it("returns 404 when task read is denied", async () => {
    requireTaskReadForRouteVarsMock.mockRejectedValue(
      new HTTPException(404, { message: "Task not found" }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123/events");

    expect(response.status).toBe(404);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 when task read is forbidden", async () => {
    requireTaskReadForRouteVarsMock.mockRejectedValue(
      new HTTPException(403, {
        message: "You can only access tasks assigned to your coworker",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123/events");

    expect(response.status).toBe(403);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
  });

  it("lists events ascending by createdAt then id with pagination meta", async () => {
    const older = makeEvent({
      id: "evt_a",
      createdAt: "2026-01-01T00:00:00.000Z",
      comment: "first",
    });
    const newerSameSecond = makeEvent({
      id: "evt_b",
      createdAt: "2026-01-01T00:00:00.000Z",
      comment: null,
    });
    taskEventFindManyMock.mockResolvedValue([older, newerSameSecond]);
    taskEventCountMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    taskEventFindFirstMock.mockResolvedValue({ id: "evt_a" });

    const app = createApp();
    const response = await app.request(
      "http://localhost/tsk_123/events?limit=20",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(taskEventFindManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123" },
      take: 21,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: expect.any(Object),
    });
    expect(body.data.map((e: { id: string }) => e.id)).toEqual([
      "evt_a",
      "evt_b",
    ]);
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 20,
      total: 2,
      nextCursor: null,
      commentCount: 1,
      latestCommentId: "evt_a",
    });
  });

  it("pages with cursor and sets nextCursor when more remain", async () => {
    const page = [
      makeEvent({ id: "evt_2", createdAt: "2026-01-02T00:00:00.000Z" }),
      makeEvent({ id: "evt_3", createdAt: "2026-01-03T00:00:00.000Z" }),
      makeEvent({ id: "evt_4", createdAt: "2026-01-04T00:00:00.000Z" }),
    ];
    taskEventFindFirstMock
      .mockResolvedValueOnce({ id: "evt_1" })
      .mockResolvedValueOnce({ id: "evt_comment" });
    taskEventFindManyMock.mockResolvedValue(page);
    taskEventCountMock.mockResolvedValueOnce(10).mockResolvedValueOnce(3);

    const app = createApp();
    const response = await app.request(
      "http://localhost/tsk_123/events?cursor=evt_1&limit=2",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(taskEventFindFirstMock).toHaveBeenCalledWith({
      where: { AND: [{ taskId: "tsk_123" }, { id: "evt_1" }] },
      select: { id: true },
    });
    expect(taskEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        skip: 1,
        cursor: { id: "evt_1" },
      }),
    );
    expect(body.data.map((e: { id: string }) => e.id)).toEqual([
      "evt_2",
      "evt_3",
    ]);
    expect(body.meta.pagination).toMatchObject({
      cursor: "evt_1",
      limit: 2,
      total: 10,
      nextCursor: "evt_3",
      commentCount: 3,
      latestCommentId: "evt_comment",
    });
  });

  it("returns null latestCommentId when there are no comments", async () => {
    taskEventFindManyMock.mockResolvedValue([
      makeEvent({ id: "evt_1", createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    taskEventCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    taskEventFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/tsk_123/events");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.pagination.commentCount).toBe(0);
    expect(body.meta.pagination.latestCommentId).toBeNull();
  });

  it("rejects an illegal cursor for the task", async () => {
    taskEventFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(
      "http://localhost/tsk_123/events?cursor=missing_evt",
    );

    expect(response.status).toBe(400);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects an illegal limit", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/tsk_123/events?limit=0",
    );

    expect(response.status).toBe(422);
    expect(taskEventFindManyMock).not.toHaveBeenCalled();
  });
});
