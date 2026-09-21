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
  notificationUpdateManyAndReturnMock,
  publishClearedNotificationsMock,
  publishChatRoomReadRealtimeMock,
  cancelNotificationEmailsMock,
  membershipFindManyMock,
  readStateFindManyMock,
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
  notificationUpdateManyAndReturnMock: vi.fn(),
  publishClearedNotificationsMock: vi.fn(),
  publishChatRoomReadRealtimeMock: vi.fn(),
  cancelNotificationEmailsMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
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
    chatRoomUserMember: { findMany: membershipFindManyMock },
    chatRoomReadState: { findMany: readStateFindManyMock },
    chatRoomPinnedMessage: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/helpers/notifications", () => ({
  publishClearedNotifications: (...args: unknown[]) =>
    publishClearedNotificationsMock(...args),
}));

vi.mock("@/helpers/chat-room-read-realtime", () => ({
  publishChatRoomReadRealtime: (...args: unknown[]) =>
    publishChatRoomReadRealtimeMock(...args),
}));

vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  cancelNotificationEmails: (...args: unknown[]) =>
    cancelNotificationEmailsMock(...args),
}));

// Background work never reaches the response, failure included — that is the
// whole point of handing it to waitUntil.
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void Promise.resolve(promise).catch(() => {});
  },
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
    updateManyAndReturn: notificationUpdateManyAndReturnMock,
  },
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
    readStates: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  readStateUpsertMock.mockResolvedValue({});
  notificationUpdateManyAndReturnMock.mockResolvedValue([]);
  membershipFindManyMock.mockResolvedValue([]);
  readStateFindManyMock.mockResolvedValue([]);
  publishChatRoomReadRealtimeMock.mockResolvedValue(undefined);
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
    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        kind: NotificationKind.CHAT,
        referenceId: ROOM_ID,
        isRead: false,
      },
      data: expect.objectContaining({
        isRead: true,
        readAt: expect.any(Date),
      }),
      select: { id: true, emailId: true, emailScheduledAt: true },
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
  it("hands the cleared rows to the publisher and to the email cancel", async () => {
    const cleared = [
      { id: "notification_1", emailId: null, emailScheduledAt: null },
      {
        id: "notification_2",
        emailId: "email_2",
        emailScheduledAt: new Date("2026-01-01T00:10:00.000Z"),
      },
    ];
    notificationUpdateManyAndReturnMock.mockResolvedValue(cleared);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith([
      "notification_1",
      "notification_2",
    ]);
    // The reader is in the room, so the email about it is no longer needed.
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(cleared);
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

  it("tells the room who read it and when", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(publishChatRoomReadRealtimeMock).toHaveBeenCalledOnce();
    expect(publishChatRoomReadRealtimeMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
      lastReadAt: expect.any(Date),
    });

    const [{ lastReadAt }] = publishChatRoomReadRealtimeMock.mock.calls[0];
    const { lastReadAt: written } = readStateUpsertMock.mock.calls[0][0].update;
    expect(lastReadAt).toEqual(written);
  });

  /**
   * Ably capabilities are per channel, never per subscriber: a guest holds
   * `subscribe` on the room channel like every other member, so anything
   * published there reaches them. The mapper's guest rule only covers the
   * payload, which would make the boundary hold for one fetch and then leak
   * live.
   */
  it("stays silent when a guest is on the room", async () => {
    roomFindFirstMock.mockResolvedValue({
      ...room(),
      userMembers: [
        ...room().userMembers,
        {
          access: "guest",
          user: {
            id: "user_guest",
            name: "Guest",
            email: "guest@example.com",
            image: null,
            sessions: [],
          },
        },
      ],
    });

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(readStateUpsertMock).toHaveBeenCalledOnce();
    expect(publishChatRoomReadRealtimeMock).not.toHaveBeenCalled();
  });

  it("still marks the room read when the read event cannot be published", async () => {
    publishChatRoomReadRealtimeMock.mockRejectedValue(new Error("ably down"));

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(readStateUpsertMock).toHaveBeenCalledOnce();
  });
});
