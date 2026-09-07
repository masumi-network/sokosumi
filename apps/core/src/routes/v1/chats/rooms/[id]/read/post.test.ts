import { MemberRole, NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountMarkChatRoomRead from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  readStateUpsertMock,
  notificationUpdateManyMock,
  notificationFindManyMock,
  notificationOutsideFindManyMock,
  publishNotificationRowMock,
  captureExceptionMock,
  membershipFindUniqueMock,
  threadReadUpsertMock,
  threadReadUpdateManyMock,
  threadReadDeleteManyMock,
  prismaTransactionMock,
  queryRawUnsafeMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationOutsideFindManyMock: vi.fn(),
  publishNotificationRowMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  membershipFindUniqueMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
  threadReadUpdateManyMock: vi.fn(),
  threadReadDeleteManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    $queryRawUnsafe: queryRawUnsafeMock,
    chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
    // Read after the transaction, to tell the reader's tabs what it cleared.
    notification: { findMany: notificationOutsideFindManyMock },
  },
}));

vi.mock("@/helpers/notifications", () => ({
  publishNotificationRow: (...args: unknown[]) =>
    publishNotificationRowMock(...args),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => promise,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomReadState: { upsert: readStateUpsertMock },
  notification: {
    findMany: notificationFindManyMock,
    updateMany: notificationUpdateManyMock,
  },
  chatRoomUserMember: { findUnique: membershipFindUniqueMock },
  chatRoomThreadReadState: {
    upsert: threadReadUpsertMock,
    updateMany: threadReadUpdateManyMock,
    deleteMany: threadReadDeleteManyMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_chat_room_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountMarkChatRoomRead(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function room() {
  return {
    id: ROOM_ID,
    organizationId: ORG_ID,
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel",
    directKey: null,
    topic: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [
      {
        user: {
          id: USER_ID,
          name: "Ada",
          email: "ada@example.com",
          image: null,
          sessions: [],
        },
      },
    ],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  readStateUpsertMock.mockResolvedValue({});
  notificationFindManyMock.mockResolvedValue([]);
  notificationUpdateManyMock.mockResolvedValue({ count: 0 });
  notificationOutsideFindManyMock.mockResolvedValue([]);
  membershipFindUniqueMock.mockResolvedValue({
    starredAt: null,
    mutedAt: null,
  });
  // Dual-baseline unread: room mark-read leaves unlooked thread replies.
  queryRawUnsafeMock.mockResolvedValue([]);
});

describe("POST /chats/rooms/{id}/read", () => {
  it("upserts lastReadAt, clears markedUnreadAt, and marks unread CHAT notifications for the room", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(readStateUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId_userId: { roomId: ROOM_ID, userId: USER_ID },
        },
        update: expect.objectContaining({
          lastReadAt: expect.any(Date),
          markedUnreadAt: null,
        }),
        create: expect.objectContaining({
          lastReadAt: expect.any(Date),
          markedUnreadAt: null,
        }),
      }),
    );
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        kind: NotificationKind.CHAT,
        referenceId: ROOM_ID,
        isRead: false,
      },
      select: { id: true },
    });
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: [] } },
      data: expect.objectContaining({
        isRead: true,
        readAt: expect.any(Date),
      }),
    });

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
      starredAt: null,
    });
    expect(queryRawUnsafeMock).toHaveBeenCalled();

    // Room mark-read must not touch per-thread look state.
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
    expect(threadReadUpdateManyMock).not.toHaveBeenCalled();
    expect(threadReadDeleteManyMock).not.toHaveBeenCalled();
  });

  /**
   * A room message stands in the notification center now, so clearing the
   * room's rows has to reach the bell. Nothing else publishes on this channel,
   * and the bell does not refetch when it is opened: without this the badge
   * keeps counting rows the server has already cleared, for the whole session.
   */
  it("tells the reader's tabs about the rows it cleared", async () => {
    notificationFindManyMock.mockResolvedValue([
      { id: "notification_1" },
      { id: "notification_2" },
    ]);
    notificationUpdateManyMock.mockResolvedValue({ count: 2 });
    notificationOutsideFindManyMock.mockResolvedValue([
      { id: "notification_1", inApp: true },
      { id: "notification_2", inApp: false },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["notification_1", "notification_2"] } },
      data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
    });
    expect(publishNotificationRowMock).toHaveBeenCalledTimes(2);
    // Each row carries its own answer, and none of them raises a banner:
    // nothing arrived, one stopped waiting. `false` says the row is a change
    // rather than a new one, so no tab counts it towards the badge.
    expect(publishNotificationRowMock.mock.calls[0]).toEqual([
      { id: "notification_1", inApp: true },
      { inApp: true, osBanner: false },
      false,
    ]);
    expect(publishNotificationRowMock.mock.calls[1]?.[1]).toEqual({
      inApp: false,
      osBanner: false,
    });
  });

  /**
   * This runs after the reader has been answered, so a read that fails must
   * not leave a rejected promise behind it. The rows come back on the next
   * fetch; the cost is a bell that lags until then.
   */
  it("swallows a failed publish rather than rejecting behind the response", async () => {
    notificationFindManyMock.mockResolvedValue([{ id: "notification_1" }]);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    notificationOutsideFindManyMock.mockRejectedValue(new Error("db down"));

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(publishNotificationRowMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the room had no unread rows", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notificationOutsideFindManyMock).not.toHaveBeenCalled();
    expect(publishNotificationRowMock).not.toHaveBeenCalled();
  });

  it("returns remaining thread unreadCount after room mark-read", async () => {
    queryRawUnsafeMock.mockResolvedValue([{ roomId: ROOM_ID, unreadCount: 2 }]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      unreadCount: 2,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });
});
