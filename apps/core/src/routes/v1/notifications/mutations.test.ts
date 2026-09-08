import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountMarkNotificationRead from "./[id]/read/patch";
import mountMarkAllRead from "./read-all/patch";
import mountGetUnreadCount from "./unread-count/get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  publishClearedNotificationsMock,
  waitUntilPromises,
  notificationCountMock,
  notificationFindManyMock,
  notificationFindUniqueMock,
  notificationUpdateManyMock,
  notificationUpdateMock,
  vendorGrantFindManyMock,
  coworkerWorkspaceAccessFindManyMock,
} = vi.hoisted(() => ({
  publishClearedNotificationsMock: vi.fn(),
  waitUntilPromises: [] as Promise<unknown>[],
  notificationCountMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationFindUniqueMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  notificationUpdateMock: vi.fn(),
  vendorGrantFindManyMock: vi.fn(),
  coworkerWorkspaceAccessFindManyMock: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  },
}));

vi.mock("@/helpers/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/notifications")>()),
  publishClearedNotifications: (...args: unknown[]) =>
    publishClearedNotificationsMock(...args),
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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mount(app);
  return app;
}

describe("PATCH /notifications/{id}/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
  });

  /**
   * Reading a row in the Notification Center leaves its OS banner standing,
   * and the two then disagree about the same room. A tab learns a row went
   * read from the republished row, which is what the room-read route already
   * sends, so this route sends it too.
   */
  it("tells the reader's tabs the row went read", async () => {
    const existing = createNotificationRow({
      kind: NotificationKind.CHAT,
      referenceId: "room_123",
      messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
    });
    notificationFindUniqueMock.mockResolvedValue(existing);
    notificationUpdateMock.mockResolvedValue({
      ...existing,
      isRead: true,
      readAt: new Date("2026-06-16T15:00:00.000Z"),
    });

    const app = createApp(mountMarkNotificationRead);
    const response = await app.request("http://localhost/notif_123/read", {
      method: "PATCH",
    });
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith(["notif_123"]);
  });

  /**
   * A banner can outlive the row it stands for: a second device raised it, or
   * an earlier publish never arrived. The reader marking the row read again is
   * them saying so again, so this route says it again rather than treating the
   * stored read flag as proof that every banner is already down.
   */
  it("tells them again for a row that was already read", async () => {
    notificationFindUniqueMock.mockResolvedValue(
      createNotificationRow({
        kind: NotificationKind.CHAT,
        referenceId: "room_123",
        messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
        isRead: true,
        readAt: new Date("2026-06-16T15:00:00.000Z"),
      }),
    );

    const app = createApp(mountMarkNotificationRead);
    await app.request("http://localhost/notif_123/read", { method: "PATCH" });
    await Promise.all(waitUntilPromises);

    expect(publishClearedNotificationsMock).toHaveBeenCalledWith(["notif_123"]);
  });

  /**
   * A mention shares the room's banner without standing for it: the counted
   * row can still be unread when the mention is read. Publishing here would
   * take the whole room's banner down while messages are still waiting.
   */
  it("publishes nothing for a mention in a room", async () => {
    const existing = createNotificationRow({
      kind: NotificationKind.CHAT,
      referenceId: "room_123",
      messageKey: CHAT_MENTION_MESSAGE_KEY,
    });
    notificationFindUniqueMock.mockResolvedValue(existing);
    notificationUpdateMock.mockResolvedValue({
      ...existing,
      isRead: true,
      readAt: new Date("2026-06-16T15:00:00.000Z"),
    });

    const app = createApp(mountMarkNotificationRead);
    await app.request("http://localhost/notif_123/read", { method: "PATCH" });
    await Promise.all(waitUntilPromises);

    expect(publishClearedNotificationsMock).not.toHaveBeenCalled();
  });

  /**
   * Only a chat banner stands for more than the row that raised it, so only a
   * chat row needs its tabs told. A job banner keeps behaving as it did.
   */
  it("publishes nothing for a row outside chat", async () => {
    const existing = createNotificationRow();
    notificationFindUniqueMock.mockResolvedValue(existing);
    notificationUpdateMock.mockResolvedValue({
      ...existing,
      isRead: true,
      readAt: new Date("2026-06-16T15:00:00.000Z"),
    });

    const app = createApp(mountMarkNotificationRead);
    await app.request("http://localhost/notif_123/read", { method: "PATCH" });
    await Promise.all(waitUntilPromises);

    expect(publishClearedNotificationsMock).not.toHaveBeenCalled();
  });

  /**
   * A room row, so ownership is what stops the publish rather than the kind
   * gate: someone else's room must not have its banner taken down.
   */
  it("publishes nothing when the row belongs to someone else", async () => {
    notificationFindUniqueMock.mockResolvedValue(
      createNotificationRow({
        userId: "user_other",
        kind: NotificationKind.CHAT,
        referenceId: "room_123",
        messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      }),
    );

    const app = createApp(mountMarkNotificationRead);
    await app.request("http://localhost/notif_123/read", { method: "PATCH" });
    await Promise.all(waitUntilPromises);

    expect(publishClearedNotificationsMock).not.toHaveBeenCalled();
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
});

describe("PATCH /notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
    notificationFindManyMock.mockResolvedValue([]);
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
        ...notificationFeedWhere(),
      },
      data: {
        isRead: true,
        readAt: expect.any(Date),
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(3);
  });

  /**
   * Mark-all-read reaches a room's counted row as well, so it takes a room's
   * banner with it. The rows are read before the write, because afterwards
   * nothing tells them apart from the rows that were already read.
   */
  it("tells the reader's tabs which room rows it cleared", async () => {
    notificationFindManyMock.mockResolvedValue([
      { id: "notif_1" },
      { id: "notif_2" },
    ]);

    const app = createApp(mountMarkAllRead);
    await app.request("http://localhost/read-all", { method: "PATCH" });
    await Promise.all(waitUntilPromises);

    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere([NotificationKind.CHAT]),
      },
      select: { id: true },
    });
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith([
      "notif_1",
      "notif_2",
    ]);
    // Read first or the rows are indistinguishable: after the write they look
    // exactly like the rows the reader had already read.
    expect(notificationFindManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      notificationUpdateManyMock.mock.invocationCallOrder[0] as number,
    );
  });
});

describe("GET /notifications/unread-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationCountMock.mockResolvedValue(5);
    notificationFindManyMock.mockResolvedValue([]);
    vendorGrantFindManyMock.mockResolvedValue([]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);
  });

  it("returns the unread count for the authenticated user", async () => {
    const app = createApp(mountGetUnreadCount);
    const response = await app.request("http://localhost/unread-count");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
      },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(5);
  });

  it("excludes resolved vendor-grant notifications from unread count", async () => {
    // Promise.all: vendor stale lookup first, coworker stale second.
    notificationFindManyMock
      .mockResolvedValueOnce([{ referenceId: "grant_resolved" }])
      .mockResolvedValueOnce([]);
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
        ...notificationFeedWhere(),
        NOT: {
          AND: [
            { messageKey: "notifications.vendorGrant.pending" },
            { referenceId: { in: ["grant_resolved"] } },
          ],
        },
      },
    });
  });

  it("excludes resolved coworker-access notifications from unread count", async () => {
    notificationFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ referenceId: "access_resolved" }]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([
      { id: "access_resolved", status: "GRANTED" },
    ]);

    const app = createApp(mountGetUnreadCount);
    const response = await app.request("http://localhost/unread-count");

    expect(response.status).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
        NOT: {
          AND: [
            { messageKey: "notifications.coworkerAccess.pending" },
            { referenceId: { in: ["access_resolved"] } },
          ],
        },
      },
    });
  });
});
