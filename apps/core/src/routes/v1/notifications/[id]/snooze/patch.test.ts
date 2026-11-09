import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountSnoozeNotification from "./patch";

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
  cancelNotificationEmailsMock,
  waitUntilPromises,
} = vi.hoisted(() => ({
  notificationFindFirstMock: vi.fn(),
  notificationUpdateMock: vi.fn(),
  cancelNotificationEmailsMock: vi.fn(),
  waitUntilPromises: [] as Promise<unknown>[],
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  },
}));

vi.mock("@/helpers/notification-email-dispatch", () => ({
  cancelNotificationEmails: (...args: unknown[]) =>
    cancelNotificationEmailsMock(...args),
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

const NOW = new Date("2026-06-16T15:00:00.000Z");
const TOMORROW = "2026-06-17T09:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif_123",
    userId: "user_123",
    kind: "TASK",
    referenceId: "task_123",
    eventId: "event_123",
    messageKey: "Notifications.Task.completed",
    messageParams: JSON.stringify({}),
    metadata: null,
    inApp: true,
    isRead: true,
    readAt: new Date("2026-06-16T14:30:00.000Z"),
    createdAt: new Date("2026-06-16T14:00:00.000Z"),
    snoozedUntil: null,
    emailId: null,
    emailScheduledAt: null,
    ...overrides,
  };
}

function patchSnooze(body: unknown, id = "notif_123") {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
    return await next();
  });
  mountSnoozeNotification(app);

  return app.request(`http://localhost/${id}/snooze`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /notifications/{id}/snooze", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
    notificationFindFirstMock.mockResolvedValue(row());
    notificationUpdateMock.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => row(data),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snoozes the row and makes it unread, so it comes back to be read", async () => {
    const response = await patchSnooze({ until: TOMORROW });

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalledWith({
      where: { id: "notif_123" },
      data: {
        snoozedUntil: new Date(TOMORROW),
        isRead: false,
        readAt: null,
      },
    });
    const body = (await response.json()) as {
      data: { isRead: boolean; snoozedUntil: string };
    };
    expect(body.data).toMatchObject({ isRead: false, snoozedUntil: TOMORROW });
  });

  it("only finds the reader's own feed rows", async () => {
    await patchSnooze({ until: TOMORROW });

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "notif_123",
        userId: "user_123",
        ...notificationFeedWhere(),
      },
    });
  });

  it("answers 404 for a row that is not the reader's", async () => {
    notificationFindFirstMock.mockResolvedValue(null);

    const response = await patchSnooze({ until: TOMORROW });

    expect(response.status).toBe(404);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("cancels an email persisted between the lookup and the snooze", async () => {
    const persisted = {
      emailId: "email_1",
      emailScheduledAt: new Date("2026-06-16T16:00:00.000Z"),
    };
    // The lookup sees no email; dispatch writes one before the snooze lands.
    notificationFindFirstMock.mockResolvedValue(row());
    notificationUpdateMock.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        row({ ...persisted, ...data }),
    );

    await patchSnooze({ until: TOMORROW });
    await Promise.all(waitUntilPromises);

    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "notif_123", ...persisted }),
    ]);
  });

  it("unsnoozes with null and leaves the read state alone", async () => {
    notificationFindFirstMock.mockResolvedValue(
      row({ isRead: false, readAt: null, snoozedUntil: new Date(TOMORROW) }),
    );

    const response = await patchSnooze({ until: null });

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).toHaveBeenCalledWith({
      where: { id: "notif_123" },
      data: { snoozedUntil: null },
    });
    expect(cancelNotificationEmailsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["in the past", "2026-06-16T14:59:00.000Z"],
    ["more than 31 days ahead", "2026-07-18T15:00:00.000Z"],
  ])("refuses a time %s", async (_label, until) => {
    const response = await patchSnooze({ until });

    expect(response.status).toBe(422);
    expect(notificationFindFirstMock).not.toHaveBeenCalled();
  });

  it("refuses chat rows, which their room counts", async () => {
    notificationFindFirstMock.mockResolvedValue(
      row({ kind: "CHAT", messageKey: "Notifications.Chat.mention" }),
    );

    const response = await patchSnooze({ until: TOMORROW });

    expect(response.status).toBe(422);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });
});
