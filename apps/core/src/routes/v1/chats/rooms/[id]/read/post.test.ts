import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole, NotificationKind } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountMarkChatRoomRead from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  readStateUpsertMock,
  notificationUpdateManyMock,
  membershipFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  membershipFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
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
  notification: { updateMany: notificationUpdateManyMock },
  chatRoomUserMember: { findUnique: membershipFindUniqueMock },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_mark_chat_room_read");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountMarkChatRoomRead(app as unknown as OpenAPIHonoWithAuth);
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  readStateUpsertMock.mockResolvedValue({});
  notificationUpdateManyMock.mockResolvedValue({ count: 2 });
  membershipFindUniqueMock.mockResolvedValue({ pinnedAt: null, mutedAt: null });
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
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
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
    });

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: ROOM_ID,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
      pinnedAt: null,
    });
  });
});
