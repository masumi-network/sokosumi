import { OpenAPIHono } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountMarkNotificationRead from "./[id]/read/patch";
import mountMarkAllRead from "./read-all/patch";
import mountGetUnreadCount from "./unread-count/get";

const {
  notificationCountMock,
  notificationFindManyMock,
  notificationFindUniqueMock,
  notificationUpdateManyMock,
  notificationUpdateMock,
  vendorGrantFindManyMock,
} = vi.hoisted(() => ({
  notificationCountMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationFindUniqueMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  notificationUpdateMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      count: notificationCountMock,
      findMany: notificationFindManyMock,
      findUnique: notificationFindUniqueMock,
      update: notificationUpdateMock,
      updateMany: notificationUpdateManyMock,
    },
    vendorGrant: {
      findMany: vendorGrantFindManyMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

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
    createdAt: new Date("2026-06-16T14:00:00.000Z"),
    ...overrides,
  };
}

function createApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mount(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("PATCH /notifications/{id}/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks an owned unread notification as read", async () => {
    const existing = createNotificationRow();
    const readAt = new Date("2026-06-16T15:00:00.000Z");
    notificationFindUniqueMock.mockResolvedValue(existing);
    notificationUpdateMock.mockResolvedValue({
      ...existing,
      isRead: true,
      readAt,
    });

    const app = createApp(mountMarkNotificationRead);
    const response = await app.request("http://localhost/notif_123/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalledWith({
      where: { id: "notif_123" },
      data: {
        isRead: true,
        readAt: expect.any(Date),
      },
    });

    const body = (await response.json()) as {
      data: { isRead: boolean; readAt: string };
    };
    expect(body.data.isRead).toBe(true);
    expect(body.data.readAt).toBe(readAt.toISOString());
  });

  it("returns the existing row without updating when already read", async () => {
    const readAt = new Date("2026-06-16T15:00:00.000Z");
    const existing = createNotificationRow({
      isRead: true,
      readAt,
    });
    notificationFindUniqueMock.mockResolvedValue(existing);

    const app = createApp(mountMarkNotificationRead);
    const response = await app.request("http://localhost/notif_123/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when marking another user's notification", async () => {
    notificationFindUniqueMock.mockResolvedValue(
      createNotificationRow({ userId: "user_other" }),
    );

    const app = createApp(mountMarkNotificationRead);
    const response = await app.request("http://localhost/notif_123/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(403);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the notification does not exist", async () => {
    notificationFindUniqueMock.mockResolvedValue(null);

    const app = createApp(mountMarkNotificationRead);
    const response = await app.request("http://localhost/notif_missing/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(404);
  });

  it("allows orchestrator with context headers to mark owned notifications read", async () => {
    const existing = createNotificationRow();
    notificationFindUniqueMock.mockResolvedValue(existing);
    notificationUpdateMock.mockResolvedValue({
      ...existing,
      isRead: true,
      readAt: new Date("2026-06-16T15:00:00.000Z"),
    });

    const app = createApp(mountMarkNotificationRead, {
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request("http://localhost/notif_123/read", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalled();
  });
});

describe("PATCH /notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationUpdateManyMock.mockResolvedValue({ count: 3 });
  });

  it("marks all unread notifications for the authenticated user", async () => {
    const app = createApp(mountMarkAllRead);
    const response = await app.request("http://localhost/read-all", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        kind: { notIn: [NotificationKind.CHAT] },
      },
      data: {
        isRead: true,
        readAt: expect.any(Date),
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(3);
  });

  it("allows orchestrator with context headers for read-all", async () => {
    const app = createApp(mountMarkAllRead, {
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request("http://localhost/read-all", {
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_123",
          isRead: false,
          kind: { notIn: [NotificationKind.CHAT] },
        },
      }),
    );
  });
});

describe("GET /notifications/unread-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCountMock.mockResolvedValue(5);
    notificationFindManyMock.mockResolvedValue([]);
    vendorGrantFindManyMock.mockResolvedValue([]);
  });

  it("returns the unread count for the authenticated user", async () => {
    const app = createApp(mountGetUnreadCount);
    const response = await app.request("http://localhost/unread-count");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        kind: { notIn: [NotificationKind.CHAT] },
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(5);
  });

  it("allows orchestrator with context headers for unread count", async () => {
    const app = createApp(mountGetUnreadCount, {
      actor: "orchestrator",
      orchestratorId: "orch_123",
      context: { userId: "user_123", organizationId: null },
    });
    const response = await app.request("http://localhost/unread-count");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        kind: { notIn: [NotificationKind.CHAT] },
      },
    });
  });

  it("excludes resolved vendor-grant notifications from unread count", async () => {
    notificationFindManyMock.mockResolvedValue([
      { referenceId: "grant_resolved" },
    ]);
    vendorGrantFindManyMock.mockResolvedValue([
      { id: "grant_resolved", status: "GRANTED" },
    ]);

    const app = createApp(mountGetUnreadCount);
    const response = await app.request("http://localhost/unread-count");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
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
});
