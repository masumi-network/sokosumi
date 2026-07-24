import { OpenAPIHono } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountGetNotifications from "./get";

const {
  notificationCountMock,
  notificationFindFirstMock,
  notificationFindManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    notification: {
      count: notificationCountMock,
      findFirst: notificationFindFirstMock,
      findMany: notificationFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountGetNotifications(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createNotificationRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "notif_123",
    userId: "user_123",
    kind: NotificationKind.JOB,
    referenceId: "job_123",
    eventId: "event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: JSON.stringify({
      agentName: "Research Agent",
      jobName: "Market Analysis",
    }),
    metadata: JSON.stringify({ agentId: "agent_123" }),
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-16T15:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationFindFirstMock.mockResolvedValue(null);
    notificationFindManyMock.mockResolvedValue([]);
    notificationCountMock.mockResolvedValue(0);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  it("lists notifications scoped to the authenticated user", async () => {
    const row = createNotificationRow();
    notificationFindManyMock.mockResolvedValue([row]);
    notificationCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
    });

    const body = (await response.json()) as {
      data: Array<{ id: string; messageKey: string }>;
      meta: { pagination: { nextCursor: string | null; total: number } };
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "notif_123",
        messageKey: "Notifications.Job.completed",
      }),
    ]);
    expect(body.meta.pagination.total).toBe(1);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("applies kind and isRead filters", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?kind=JOB,TASK&isRead=false",
    );

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          kind: { in: [NotificationKind.JOB, NotificationKind.TASK] },
          isRead: false,
        },
      }),
    );
  });

  it("allows orchestrator with context headers as the context user", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: "org_123" },
    });
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_123" },
      }),
    );
  });

  it("returns 403 for bare orchestrator without context headers", async () => {
    const app = createApp({
      actor: "orchestrator",
      orchestratorId: "orch_123",
    });
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });

  it("validates cursors against the same user and filter scope", async () => {
    notificationFindFirstMock.mockResolvedValue({ id: "notif_cursor" });

    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=notif_cursor&kind=JOB&isRead=false&limit=10",
    );

    expect(response.status).toBe(200);
    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            userId: "user_123",
            kind: { in: [NotificationKind.JOB] },
            isRead: false,
          },
          { id: "notif_cursor" },
        ],
      },
      select: { id: true },
    });
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "notif_cursor" },
        skip: 1,
        take: 11,
      }),
    );
  });

  it("returns 400 when the cursor is outside the scoped query", async () => {
    notificationFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?cursor=notif_missing&kind=JOB",
    );

    expect(response.status).toBe(400);
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });
});
