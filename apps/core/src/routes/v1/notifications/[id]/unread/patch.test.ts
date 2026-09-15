import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { notificationFindUniqueMock, notificationUpdateMock } = vi.hoisted(
  () => ({
    notificationFindUniqueMock: vi.fn(),
    notificationUpdateMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      findUnique: notificationFindUniqueMock,
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
    notificationFindUniqueMock.mockResolvedValue(readRow());
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

  it("writes nothing when the row is already unread", async () => {
    notificationFindUniqueMock.mockResolvedValue(
      readRow({ isRead: false, readAt: null }),
    );

    const response = await patchUnread();

    expect(response.status).toBe(200);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a row belonging to someone else", async () => {
    notificationFindUniqueMock.mockResolvedValue(
      readRow({ userId: "someone_else" }),
    );

    const response = await patchUnread();

    expect(response.status).toBe(403);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it("reports a row that is not there", async () => {
    notificationFindUniqueMock.mockResolvedValue(null);

    const response = await patchUnread();

    expect(response.status).toBe(404);
  });
});
