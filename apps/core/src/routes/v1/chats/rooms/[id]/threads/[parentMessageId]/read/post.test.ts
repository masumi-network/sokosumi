import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChatRoomThreadRead from "./post";

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
  messageFindFirstMock,
  messageFindManyMock,
  threadReadUpsertMock,
  threadReadFindManyMock,
  notificationFindManyMock,
  notificationUpdateManyAndReturnMock,
  publishClearedNotificationsMock,
  cancelNotificationEmailsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
  threadReadFindManyMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationUpdateManyAndReturnMock: vi.fn(),
  publishClearedNotificationsMock: vi.fn(),
  cancelNotificationEmailsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    chatRoomMessage: {
      findFirst: messageFindFirstMock,
      findMany: messageFindManyMock,
    },
    chatRoomUserMention: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomMention: { findMany: vi.fn().mockResolvedValue([]) },
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
      findMany: threadReadFindManyMock,
    },
    notification: {
      findMany: notificationFindManyMock,
      updateManyAndReturn: notificationUpdateManyAndReturnMock,
    },
  },
}));

vi.mock("@/helpers/notifications", () => ({
  publishClearedNotifications: (...args: unknown[]) =>
    publishClearedNotificationsMock(...args),
}));

vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  cancelNotificationEmails: (...args: unknown[]) =>
    cancelNotificationEmailsMock(...args),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void Promise.resolve(promise).catch(() => {});
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_chat_room_thread_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPostChatRoomThreadRead(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: "01960001-0001-7001-8001-000000000001",
  context: { userId: USER_ID, organizationId: ORG_ID },
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

/**
 * Answers the Thread-reply read with `replies`, and says the reader wrote
 * every parent, so each Thread counts as Participated.
 */
function answerThreadReplies(
  replies: Array<{
    id: string;
    roomId: string;
    parentMessageId: string;
    createdAt: Date;
  }>,
) {
  messageFindManyMock.mockImplementation(async ({ where }) => {
    if (where.parentMessageId?.not === null) {
      return replies;
    }
    if (where.id) {
      // The reader wrote every parent: a Thread they Participate in.
      return replies.map((reply) => ({
        id: reply.parentMessageId,
        senderUserId: USER_ID,
      }));
    }
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  messageFindFirstMock.mockResolvedValue({ id: PARENT_ID });
  threadReadUpsertMock.mockResolvedValue({
    parentMessageId: PARENT_ID,
    lastReadAt: new Date("2026-07-02T12:00:00.000Z"),
  });
  notificationFindManyMock.mockResolvedValue([]);
  messageFindManyMock.mockResolvedValue([]);
  threadReadFindManyMock.mockResolvedValue([]);
  notificationUpdateManyAndReturnMock.mockResolvedValue([]);
});

describe("POST /chats/rooms/{id}/threads/{parentMessageId}/read", () => {
  it("upserts ChatRoomThreadReadState for the parent", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(messageFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PARENT_ID,
        roomId: ROOM_ID,
        parentMessageId: null,
      },
      select: { id: true },
    });
    expect(threadReadUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_parentMessageId: {
            userId: USER_ID,
            parentMessageId: PARENT_ID,
          },
        },
        update: { lastReadAt: expect.any(Date) },
        create: expect.objectContaining({
          userId: USER_ID,
          parentMessageId: PARENT_ID,
          lastReadAt: expect.any(Date),
        }),
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual({
      parentMessageId: PARENT_ID,
      lastReadAt: "2026-07-02T12:00:00.000Z",
    });
  });

  /**
   * SOK-1217. Room last-read leaves a Thread reply's row unread, so the Look
   * is what clears it, and the bell and the email hear about it the same way
   * they do for Room last-read.
   */
  it("clears the rows for the replies the Look covers", async () => {
    const replyAt = new Date("2026-07-02T11:00:00.000Z");
    notificationFindManyMock.mockResolvedValue([
      { id: "n-reply", referenceId: ROOM_ID, eventId: "msg-reply" },
    ]);
    answerThreadReplies([
      {
        id: "msg-reply",
        roomId: ROOM_ID,
        parentMessageId: PARENT_ID,
        createdAt: replyAt,
      },
    ]);
    threadReadFindManyMock.mockResolvedValue([
      {
        parentMessageId: PARENT_ID,
        lastReadAt: new Date("2026-07-02T12:00:00.000Z"),
      },
    ]);
    const cleared = [
      { id: "n-reply", emailId: "email_1", emailScheduledAt: replyAt },
    ];
    notificationUpdateManyAndReturnMock.mockResolvedValue(cleared);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notificationUpdateManyAndReturnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["n-reply"] }, userId: USER_ID, isRead: false },
      }),
    );
    expect(publishClearedNotificationsMock).toHaveBeenCalledWith(["n-reply"]);
    expect(cancelNotificationEmailsMock).toHaveBeenCalledWith(cleared);
  });

  it("returns 404 when the parent message is missing", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyAndReturnMock).not.toHaveBeenCalled();
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/read`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(threadReadUpsertMock).not.toHaveBeenCalled();
  });
});
