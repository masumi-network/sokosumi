import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountMarkNotificationsRead from "./patch";

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
  notificationUpdateManyAndReturnMock,
} = vi.hoisted(() => ({
  publishClearedNotificationsMock: vi.fn(),
  waitUntilPromises: [] as Promise<unknown>[],
  notificationUpdateManyAndReturnMock: vi.fn(),
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
      updateManyAndReturn: notificationUpdateManyAndReturnMock,
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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountMarkNotificationsRead(app);
  return app;
}

function patchRead(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("http://localhost/read", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /notifications/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
    notificationUpdateManyAndReturnMock.mockResolvedValue([]);
  });

  it("marks only the named rows, scoped to the reader and the feed rule", async () => {
    notificationUpdateManyAndReturnMock.mockResolvedValue([
      {
        id: "notif_1",
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      },
      {
        id: "notif_2",
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      },
    ]);

    const response = await patchRead(createApp(), {
      ids: ["notif_1", "notif_2"],
    });

    expect(response.status).toBe(200);
    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["notif_1", "notif_2"] },
        userId: "user_123",
        isRead: false,
        ...notificationFeedWhere(),
      },
      data: {
        isRead: true,
        readAt: expect.any(Date),
      },
      select: { id: true, kind: true, messageKey: true },
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(2);
  });

  it("counts only the rows the write actually changed", async () => {
    // Three ids asked for, one already read and one belonging to someone
    // else: the where clause drops both, so the count is what changed.
    notificationUpdateManyAndReturnMock.mockResolvedValue([
      {
        id: "notif_1",
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      },
    ]);

    const response = await patchRead(createApp(), {
      ids: ["notif_1", "notif_already_read", "notif_someone_else"],
    });

    const body = (await response.json()) as { data: { count: number } };
    expect(body.data.count).toBe(1);
  });

  it("publishes a clear only for the room rows a banner stands for", async () => {
    notificationUpdateManyAndReturnMock.mockResolvedValue([
      {
        id: "notif_room",
        kind: NotificationKind.CHAT,
        messageKey: CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      },
      {
        id: "notif_mention",
        kind: NotificationKind.CHAT,
        messageKey: CHAT_MENTION_MESSAGE_KEY,
      },
      {
        id: "notif_job",
        kind: NotificationKind.JOB,
        messageKey: "Notifications.Job.completed",
      },
    ]);

    const response = await patchRead(createApp(), {
      ids: ["notif_room", "notif_mention", "notif_job"],
    });

    expect(response.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith([
      "notif_room",
    ]);
  });

  it("rejects an empty id list", async () => {
    const response = await patchRead(createApp(), { ids: [] });

    expect(response.status).toBe(422);
    expect(notificationUpdateManyAndReturnMock).not.toHaveBeenCalled();
  });

  it("rejects more ids than one request may carry", async () => {
    const ids = Array.from({ length: 26 }, (_, index) => `notif_${index}`);

    const response = await patchRead(createApp(), { ids });

    expect(response.status).toBe(422);
    expect(notificationUpdateManyAndReturnMock).not.toHaveBeenCalled();
  });
});
