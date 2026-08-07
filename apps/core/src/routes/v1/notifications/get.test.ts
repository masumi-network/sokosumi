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
  vendorGrantFindManyMock,
  coworkerWorkspaceAccessFindManyMock,
} = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
  coworkerWorkspaceAccessFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    notification: {
      count: notificationCountMock,
      findFirst: notificationFindFirstMock,
      findMany: notificationFindManyMock,
    },
    vendorGrant: {
      findMany: vendorGrantFindManyMock,
    },
    coworkerWorkspaceAccess: {
      findMany: coworkerWorkspaceAccessFindManyMock,
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
    // Default: stale access-request lookups find no pending notifications.
    notificationFindManyMock.mockResolvedValue([]);
    notificationCountMock.mockResolvedValue(0);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(
      async (operations: Array<Promise<unknown>>) =>
        await Promise.all(operations),
    );
  });

  it("lists notifications scoped to the authenticated user", async () => {
    const row = createNotificationRow();
    // findMany: vendor stale, coworker stale (Promise.all), then page.
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row]);
    notificationCountMock.mockResolvedValue(1);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith({
      where: {
        userId: "user_123",
        kind: { notIn: [NotificationKind.CHAT] },
      },
      take: LIMITS.DEFAULT_PAGINATION_LIMIT + 1,
      skip: undefined,
      cursor: undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        kind: { notIn: [NotificationKind.CHAT] },
      },
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

  it("strips CHAT from an explicit kind filter", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?kind=JOB,CHAT&isRead=false",
    );

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          kind: { in: [NotificationKind.JOB] },
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
        where: {
          userId: "user_123",
          kind: { notIn: [NotificationKind.CHAT] },
        },
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
    // Only stale access-request lookups run; the page query does not.
    expect(notificationFindManyMock).toHaveBeenCalledTimes(2);
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        messageKey: "notifications.vendorGrant.pending",
      },
      select: { referenceId: true },
    });
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        messageKey: "notifications.coworkerAccess.pending",
      },
      select: { referenceId: true },
    });
  });

  it("excludes resolved vendor-grant notifications from the feed where clause", async () => {
    // Promise.all order: vendor stale lookup, coworker stale lookup, then page.
    notificationFindManyMock
      .mockResolvedValueOnce([
        { referenceId: "grant_resolved" },
        { referenceId: "grant_pending" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vendorGrantFindManyMock.mockResolvedValue([
      { id: "grant_pending", status: "PENDING" },
      { id: "grant_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          kind: { notIn: [NotificationKind.CHAT] },
          NOT: {
            AND: [
              { messageKey: "notifications.vendorGrant.pending" },
              { referenceId: { in: ["grant_resolved"] } },
            ],
          },
        },
      }),
    );
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        kind: { notIn: [NotificationKind.CHAT] },
        NOT: {
          AND: [
            { messageKey: "notifications.vendorGrant.pending" },
            { referenceId: { in: ["grant_resolved"] } },
          ],
        },
      },
    });
  });

  it("excludes resolved coworker-access notifications from the feed where clause", async () => {
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { referenceId: "access_resolved" },
        { referenceId: "access_pending" },
      ])
      .mockResolvedValueOnce([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([
      { id: "access_pending", status: "PENDING" },
      { id: "access_resolved", status: "GRANTED" },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(notificationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          kind: { notIn: [NotificationKind.CHAT] },
          NOT: {
            AND: [
              { messageKey: "notifications.coworkerAccess.pending" },
              { referenceId: { in: ["access_resolved"] } },
            ],
          },
        },
      }),
    );
  });
});
