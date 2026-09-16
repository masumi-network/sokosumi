import { beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountMarkNotificationUnread from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  notificationFindFirstMock,
  notificationUpdateMock,
  publishNotificationRowMock,
  waitUntilPromises,
} = vi.hoisted(() => ({
  notificationFindFirstMock: vi.fn(),
  notificationUpdateMock: vi.fn(),
  publishNotificationRowMock: vi.fn(),
  waitUntilPromises: [] as Promise<unknown>[],
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  },
}));

vi.mock("@/helpers/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/notifications")>()),
  publishNotificationRow: (...args: unknown[]) =>
    publishNotificationRowMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      findFirst: notificationFindFirstMock,
      update: notificationUpdateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function readRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif_123",
    userId: "user_123",
    kind: "JOB",
    referenceId: "job_123",
    eventId: "event_123",
    messageKey: "Notifications.Job.completed",
    messageParams: JSON.stringify({}),
    metadata: null,
    inApp: true,
    isRead: true,
    readAt: new Date("2026-06-16T15:00:00.000Z"),
    createdAt: new Date("2026-06-16T14:00:00.000Z"),
    ...overrides,
  };
}

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountMarkNotificationUnread(app);
  return app;
}

function patchUnread(id = "notif_123") {
  return createApp().request(`http://localhost/${id}/unread`, {
    method: "PATCH",
  });
}

describe("PATCH /notifications/{id}/unread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
    notificationFindFirstMock.mockResolvedValue(readRow());
    notificationUpdateMock.mockImplementation(async () =>
      readRow({ isRead: false, readAt: null }),
    );
  });

  it("puts a read row back and clears the time it was read", async () => {
    const response = await patchUnread();

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalledWith({
      where: { id: "notif_123" },
      data: { isRead: false, readAt: null },
    });

    const body = (await response.json()) as {
      data: { isRead: boolean; readAt: string | null };
    };
    expect(body.data.isRead).toBe(false);
    expect(body.data.readAt).toBeNull();
  });

  it("looks the row up through the feed rule, not by id alone", async () => {
    await patchUnread();

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: { id: "notif_123", ...notificationFeedWhere() },
    });
  });

  it("tells the reader's other tabs, without raising a banner", async () => {
    await patchUnread();

    await Promise.all(waitUntilPromises);
    expect(publishNotificationRowMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "notif_123", isRead: false }),
      // No email: the reader is putting a row back in their own feed, which
      // sends nothing.
      { email: false, inApp: true, osBanner: false },
      false,
    );
  });

  it("writes nothing when the row is already unread", async () => {
    notificationFindFirstMock.mockResolvedValue(
      readRow({ isRead: false, readAt: null }),
    );

    const response = await patchUnread();

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
    // Nothing changed, so there is nothing for another tab to hear about.
    expect(publishNotificationRowMock).not.toHaveBeenCalled();
  });

  it("refuses a row belonging to someone else", async () => {
    notificationFindFirstMock.mockResolvedValue(
      readRow({ userId: "someone_else" }),
    );

    const response = await patchUnread();

    expect(response.status).toBe(403);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("reports a row that is not there, or that the feed never shows", async () => {
    // findFirst carries the feed rule, so a silenced or browser-only row
    // comes back null exactly as a missing one does.
    notificationFindFirstMock.mockResolvedValue(null);

    const response = await patchUnread();

    expect(response.status).toBe(404);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });
});
