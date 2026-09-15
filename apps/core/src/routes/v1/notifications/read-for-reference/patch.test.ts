import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountMarkReadForReference from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { markNotificationsReadMock } = vi.hoisted(() => ({
  markNotificationsReadMock: vi.fn(),
}));

vi.mock("@/helpers/notification-read", () => ({
  markNotificationsRead: markNotificationsReadMock,
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
): OpenAPIHonoWithAuth {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountMarkReadForReference(app);
  return app;
}

function patch(body: unknown) {
  return createApp().request("http://localhost/read-for-reference", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /notifications/read-for-reference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markNotificationsReadMock.mockResolvedValue({
      count: 2,
      clearedRoomIds: [],
    });
  });

  it("marks the reader's unread rows for one task read", async () => {
    const response = await patch({
      kind: NotificationKind.TASK,
      referenceId: "task_123",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { count: 2 },
    });
  });

  /**
   * The whole point of the route. A reader who opens the task page has dealt
   * with what the notification was about, so the row must not survive to be
   * reminded about a day later (SOK-916).
   */
  it("scopes the write to this reader, this kind and this reference", async () => {
    await patch({ kind: NotificationKind.TASK, referenceId: "task_123" });

    // The reference is the whole of what this route adds. The reader's id, the
    // unread state and the feed rule belong to the shared write, which is what
    // stops this route from reaching a row the feed would never show. Asserted
    // exactly, so a scoping clause added back here fails rather than passes as
    // a harmless duplicate.
    expect(markNotificationsReadMock).toHaveBeenCalledWith("user_123", {
      kind: NotificationKind.TASK,
      referenceId: "task_123",
    });
  });

  it("marks the reader's unread rows for one job read", async () => {
    await patch({ kind: NotificationKind.JOB, referenceId: "job_123" });

    expect(markNotificationsReadMock).toHaveBeenCalledWith("user_123", {
      kind: NotificationKind.JOB,
      referenceId: "job_123",
    });
  });

  /**
   * Chat is refused rather than supported. Opening a room does more than mark
   * notifications read: it moves the membership's `lastReadAt` and republishes
   * the cleared rows so other tabs and the sidebar badge agree. A second path
   * that did only half of that would leave the room's own surfaces disagreeing
   * about the same rows.
   */
  it("refuses chat, which has a room-read route that does more", async () => {
    const response = await patch({
      kind: NotificationKind.CHAT,
      referenceId: "room_123",
    });

    expect(response.status).toBe(422);
    expect(markNotificationsReadMock).not.toHaveBeenCalled();
  });

  it("refuses a blank reference rather than reading everything", async () => {
    const response = await patch({
      kind: NotificationKind.TASK,
      referenceId: "",
    });

    expect(response.status).toBe(422);
    expect(markNotificationsReadMock).not.toHaveBeenCalled();
  });

  it("says nothing was read when nothing was unread", async () => {
    markNotificationsReadMock.mockResolvedValue({
      count: 0,
      clearedRoomIds: [],
    });

    const response = await patch({
      kind: NotificationKind.TASK,
      referenceId: "task_123",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { count: 0 },
    });
  });
});
