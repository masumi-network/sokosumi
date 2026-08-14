import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomThreads from "./get";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  queryRawUnsafeMock,
  messageFindManyMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  messageFindManyMock: vi.fn(),
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
    $queryRawUnsafe: queryRawUnsafeMock,
    chatRoomMessage: {
      findMany: messageFindManyMock,
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";
const COWORKER_ID = "cow_123";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_threads");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomThreads(app as unknown as OpenAPIHonoWithAuth);
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
  };
}

function parentMessage() {
  return {
    id: PARENT_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Thread root",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    editedAt: null,
    metadata: null,
    senderUser: {
      id: USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    _count: { replies: 2 },
  };
}

function aggregateRow() {
  return {
    parentMessageId: PARENT_ID,
    replyCount: 2,
    lastReplyAt: new Date("2026-07-02T12:00:00.000Z"),
    unreadReplyCount: 1,
    lastUnreadReplyAt: new Date("2026-07-02T12:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  roomFindFirstMock.mockResolvedValue(room());
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  queryRawUnsafeMock.mockResolvedValue([aggregateRow()]);
  messageFindManyMock.mockResolvedValue([parentMessage()]);
});

describe("GET /chats/rooms/{id}/threads", () => {
  it("returns mapped thread items when unread=true", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads?unread=true`,
    );

    expect(response.status).toBe(200);
    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    expect(messageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [PARENT_ID] },
          roomId: ROOM_ID,
          parentMessageId: null,
          deletedAt: null,
        },
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        parentMessage: expect.objectContaining({
          id: PARENT_ID,
          content: "Thread root",
        }),
        replyCount: 2,
        lastReplyAt: "2026-07-02T12:00:00.000Z",
        unreadReplyCount: 1,
        lastUnreadReplyAt: "2026-07-02T12:00:00.000Z",
      }),
    ]);
  });

  it("returns all threads when unread is omitted", async () => {
    const lookedId = "550e8400-e29b-41d4-a716-446655440099";
    queryRawUnsafeMock
      .mockResolvedValueOnce([aggregateRow()])
      .mockResolvedValueOnce([
        {
          parentMessageId: lookedId,
          replyCount: 1,
          lastReplyAt: new Date("2026-06-01T00:00:00.000Z"),
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
        },
      ])
      .mockResolvedValueOnce([{ count: 2 }]);
    messageFindManyMock.mockResolvedValue([
      parentMessage(),
      { ...parentMessage(), id: lookedId, content: "Looked thread" },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads`,
    );

    expect(response.status).toBe(200);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(3);
    expect(messageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: [PARENT_ID, lookedId],
          },
        }),
      }),
    );

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      parentMessage: expect.objectContaining({ id: PARENT_ID }),
      replyCount: 2,
      unreadReplyCount: 1,
    });
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("puts unread threads first then a recency page when listing all", async () => {
    const lookedId = "550e8400-e29b-41d4-a716-446655440099";
    const extraId = "550e8400-e29b-41d4-a716-446655440098";
    queryRawUnsafeMock
      .mockResolvedValueOnce([aggregateRow()])
      .mockResolvedValueOnce([
        {
          parentMessageId: lookedId,
          replyCount: 1,
          lastReplyAt: new Date("2026-06-01T00:00:00.000Z"),
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
        },
        {
          parentMessageId: extraId,
          replyCount: 1,
          lastReplyAt: new Date("2026-05-01T00:00:00.000Z"),
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
        },
      ])
      .mockResolvedValueOnce([{ count: 4 }]);
    messageFindManyMock.mockResolvedValue([
      parentMessage(),
      { ...parentMessage(), id: lookedId, content: "Looked thread" },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads?limit=1`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.data.map(
        (row: { parentMessage: { id: string } }) => row.parentMessage.id,
      ),
    ).toEqual([PARENT_ID, lookedId]);
    expect(body.data[0].unreadReplyCount).toBe(1);
    expect(body.data[1].unreadReplyCount).toBe(0);
    expect(body.meta.pagination).toMatchObject({
      limit: 1,
      total: 4,
      nextCursor: lookedId,
    });
  });

  it("pages recency only when a cursor is set", async () => {
    const lookedId = "550e8400-e29b-41d4-a716-446655440099";
    queryRawUnsafeMock
      .mockResolvedValueOnce([
        {
          parentMessageId: lookedId,
          replyCount: 1,
          lastReplyAt: new Date("2026-06-01T00:00:00.000Z"),
          unreadReplyCount: 0,
          lastUnreadReplyAt: null,
        },
      ])
      .mockResolvedValueOnce([{ count: 3 }]);
    messageFindManyMock.mockResolvedValue([
      { ...parentMessage(), id: lookedId, content: "Older looked" },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads?cursor=${PARENT_ID}&limit=1`,
    );

    expect(response.status).toBe(200);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].parentMessage.id).toBe(lookedId);
    expect(body.data[0].unreadReplyCount).toBe(0);
    expect(body.meta.pagination.nextCursor).toBeNull();
  });

  it("rejects coworker auth with 403", async () => {
    const response = await createApp(coworkerAuthContext).request(
      `/${ROOM_ID}/threads?unread=true`,
    );

    expect(response.status).toBe(403);
    expect(roomFindFirstMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });
});
