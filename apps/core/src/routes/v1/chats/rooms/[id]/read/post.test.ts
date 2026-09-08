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
  publishClearedNotificationsMock,
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
  publishClearedNotificationsMock: vi.fn(),
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
  },
}));

vi.mock("@/helpers/notifications", () => ({
  publishClearedNotifications: (...args: unknown[]) =>
    publishClearedNotificationsMock(...args),
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
   * room's rows has to reach the bell, and a chat banner stands for the whole
   * room and has to come down with it. Both follow the cleared rows, which
   * `publishClearedNotifications` sends; what it sends is covered where it
   * lives, in `helpers/notifications.test.ts`.
   */
  it("hands the cleared rows to the publisher", async () => {
    notificationFindManyMock.mockResolvedValue([
      { id: "notification_1" },
      { id: "notification_2" },
    ]);
    notificationUpdateManyMock.mockResolvedValue({ count: 2 });

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["notification_1", "notification_2"] } },
      data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
    });
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith([
      "notification_1",
      "notification_2",
    ]);
  });

  it("hands over an empty list when the room had no unread rows", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith([]);
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
