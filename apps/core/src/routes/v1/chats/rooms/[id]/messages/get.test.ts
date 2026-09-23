import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tooManyRequests } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomMessages from "./get";

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
  messageCountMock,
  prismaTransactionMock,
  queryRawUnsafeMock,
  listStaleSentChatRoomMentionIdsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCountMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  listStaleSentChatRoomMentionIdsMock: vi.fn(),
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
      count: messageCountMock,
    },
    $transaction: prismaTransactionMock,
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: vi.fn(),
}));
vi.mock("@/services/chat-room-mention-state", () => ({
  listStaleSentChatRoomMentionIds: (...args: unknown[]) =>
    listStaleSentChatRoomMentionIdsMock(...args),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

const { assertChatMessageReadBudgetMock } = vi.hoisted(() => ({
  assertChatMessageReadBudgetMock: vi.fn(),
}));

vi.mock("@/helpers/chat-message-read-budget", () => ({
  assertChatMessageReadBudget: assertChatMessageReadBudgetMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const NEWER_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440011";
const OLDER_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440021";
const REPLY_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440022";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_messages");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomMessages(app);
  return app;
}

/** One row of the viewer's unread-thread aggregate, as the database returns it. */
function unreadThreadRow(parentMessageId: string, unreadReplyCount: number) {
  return {
    parentMessageId,
    replyCount: unreadReplyCount,
    lastReplyAt: new Date("2026-01-05T00:00:00.000Z"),
    unreadReplyCount,
    lastUnreadReplyAt: new Date("2026-01-05T00:00:00.000Z"),
    hasLooked: false,
    mutedAt: null,
  };
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function message() {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "Hello room",
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
    pins: [],
    replies: [],
    _count: { replies: 0 },
  };
}

/** One row of a parent's `replies` include, as the database returns it. */
function userReply(id: string, name: string, createdAt: string) {
  return {
    createdAt: new Date(createdAt),
    senderUser: { id, name, email: `${id}@example.com`, image: null },
    senderCoworker: null,
    senderSokoBot: null,
  };
}

function coworkerReply(id: string, name: string, createdAt: string) {
  return {
    createdAt: new Date(createdAt),
    senderUser: null,
    senderCoworker: { id, name, slug: id, caption: null, image: null },
    senderSokoBot: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  messageFindFirstMock.mockReset();
  messageFindManyMock.mockReset();
  messageCountMock.mockReset();
  roomFindFirstMock.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
    userMembers: [{ access: "member" }],
  });
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  messageFindManyMock.mockResolvedValue([message()]);
  messageCountMock.mockResolvedValue(1);
  queryRawUnsafeMock.mockReset();
  queryRawUnsafeMock.mockResolvedValue([]);
  listStaleSentChatRoomMentionIdsMock.mockResolvedValue([]);
  assertChatMessageReadBudgetMock.mockResolvedValue(undefined);
});

describe("GET /chats/rooms/{id}/messages", () => {
  it("returns messages without opening an interactive transaction", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(roomFindFirstMock).toHaveBeenCalledOnce();
    expect(messageFindManyMock).toHaveBeenCalledOnce();
    expect(messageCountMock).toHaveBeenCalledOnce();

    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: MESSAGE_ID,
        roomId: ROOM_ID,
        content: "Hello room",
      }),
    ]);
  });

  it("marks pinned messages with pinnedAt and leaves the rest null", async () => {
    const pinned = {
      ...message(),
      pins: [{ pinnedAt: new Date("2026-01-03T09:30:00.000Z") }],
    };
    const unpinned = {
      ...message(),
      id: NEWER_MESSAGE_ID,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      pins: [],
    };
    messageFindManyMock.mockResolvedValue([unpinned, pinned]);
    messageCountMock.mockResolvedValue(2);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.data.map((row: { id: string; pinnedAt: string | null }) => [
        row.id,
        row.pinnedAt,
      ]),
    ).toEqual([
      [MESSAGE_ID, "2026-01-03T09:30:00.000Z"],
      [NEWER_MESSAGE_ID, null],
    ]);
  });

  it("returns null pinnedAt for a deleted message that is still pinned", async () => {
    messageFindManyMock.mockResolvedValue([
      {
        ...message(),
        deletedAt: new Date("2026-01-04T00:00:00.000Z"),
        pins: [{ pinnedAt: new Date("2026-01-03T09:30:00.000Z") }],
      },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].pinnedAt).toBeNull();
  });

  it("returns 429 with Retry-After when the read budget is exhausted", async () => {
    assertChatMessageReadBudgetMock.mockRejectedValue(
      tooManyRequests("Chat history read budget exceeded.", {
        kind: "message_read_budget_exceeded",
        retryAfterSeconds: 7,
      }),
    );

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(messageFindManyMock).not.toHaveBeenCalled();
    expect(messageCountMock).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.kind).toBe("message_read_budget_exceeded");
    expect(body.retryAfterSeconds).toBe(7);
  });

  it("returns 404 when the room is missing", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(404);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(messageFindManyMock).not.toHaveBeenCalled();
    expect(messageCountMock).not.toHaveBeenCalled();
  });

  it("returns the live timeline in oldest-first reading order", async () => {
    const newer = {
      ...message(),
      id: NEWER_MESSAGE_ID,
      content: "Hello newer",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const older = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      content: "Hello older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    messageFindManyMock.mockResolvedValue([newer, older]);
    messageCountMock.mockResolvedValue(2);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      OLDER_MESSAGE_ID,
      NEWER_MESSAGE_ID,
    ]);
  });

  it("returns search hits newest-first when q is set", async () => {
    const newer = {
      ...message(),
      id: NEWER_MESSAGE_ID,
      content: "Hello newer",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const older = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      content: "Hello older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    messageFindManyMock.mockResolvedValue([newer, older]);
    messageCountMock.mockResolvedValue(2);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=Hello`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      NEWER_MESSAGE_ID,
      OLDER_MESSAGE_ID,
    ]);
  });

  it("filters by content when q is set and searches all thread depths", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=Hello`,
    );

    expect(response.status).toBe(200);
    expect(messageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: ROOM_ID,
          deletedAt: null,
          content: { contains: "Hello", mode: "insensitive" },
        },
      }),
    );
    expect(listStaleSentChatRoomMentionIdsMock).not.toHaveBeenCalled();
  });

  it("rejects blank q", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=%20%20`,
    );

    expect(response.status).toBe(422);
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects around combined with q", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=Hello&around=${MESSAGE_ID}`,
    );

    expect(response.status).toBe(422);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects around combined with cursor", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?around=${MESSAGE_ID}&cursor=${OLDER_MESSAGE_ID}`,
    );

    expect(response.status).toBe(422);
    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the around target is missing", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?around=${MESSAGE_ID}`,
    );

    expect(response.status).toBe(404);
    expect(messageFindManyMock).not.toHaveBeenCalled();
  });

  it("returns a reading-order window centred on around", async () => {
    const center = {
      ...message(),
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const older = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      content: "Hello older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const newer = {
      ...message(),
      id: NEWER_MESSAGE_ID,
      content: "Hello newer",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    };
    messageFindFirstMock.mockResolvedValue(center);
    messageFindManyMock.mockImplementation(
      async (args: { orderBy?: Array<{ createdAt?: string }> }) => {
        const createdAtOrder = args.orderBy?.[0]?.createdAt;
        if (createdAtOrder === "desc") {
          return [older];
        }
        return [newer];
      },
    );
    messageCountMock.mockResolvedValue(3);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?around=${MESSAGE_ID}&limit=3`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      OLDER_MESSAGE_ID,
      MESSAGE_ID,
      NEWER_MESSAGE_ID,
    ]);
    expect(listStaleSentChatRoomMentionIdsMock).not.toHaveBeenCalled();
  });

  it("centres a reply around on its top-level parent", async () => {
    const parent = {
      ...message(),
      id: PARENT_MESSAGE_ID,
      content: "Thread parent",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const reply = {
      ...message(),
      id: REPLY_MESSAGE_ID,
      parentMessageId: PARENT_MESSAGE_ID,
      content: "Thread reply",
      createdAt: new Date("2026-01-02T01:00:00.000Z"),
    };
    const older = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      content: "Hello older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const newer = {
      ...message(),
      id: NEWER_MESSAGE_ID,
      content: "Hello newer",
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    };
    messageFindFirstMock
      .mockResolvedValueOnce(reply)
      .mockResolvedValueOnce(parent);
    messageFindManyMock.mockImplementation(
      async (args: { orderBy?: Array<{ createdAt?: string }> }) => {
        const createdAtOrder = args.orderBy?.[0]?.createdAt;
        if (createdAtOrder === "desc") {
          return [older];
        }
        return [newer];
      },
    );
    messageCountMock.mockResolvedValue(3);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?around=${REPLY_MESSAGE_ID}&limit=3`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((row: { id: string }) => row.id)).toEqual([
      OLDER_MESSAGE_ID,
      PARENT_MESSAGE_ID,
      NEWER_MESSAGE_ID,
    ]);
  });

  it("reports the viewer's unread reply count on each thread parent", async () => {
    const unreadParent = {
      ...message(),
      id: PARENT_MESSAGE_ID,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      _count: { replies: 5 },
    };
    // A busy thread the viewer only lurks in: no aggregate row comes back for
    // it, so it must read 0 rather than its reply count.
    const lurkedParent = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      _count: { replies: 20 },
    };
    messageFindManyMock.mockResolvedValue([unreadParent, lurkedParent]);
    messageCountMock.mockResolvedValue(2);
    queryRawUnsafeMock.mockResolvedValue([
      unreadThreadRow(PARENT_MESSAGE_ID, 2),
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: OLDER_MESSAGE_ID,
        threadReplyCount: 20,
        threadUnreadReplyCount: 0,
      }),
      expect.objectContaining({
        id: PARENT_MESSAGE_ID,
        threadReplyCount: 5,
        threadUnreadReplyCount: 2,
      }),
    ]);
  });

  it("skips the unread thread read for a page with no threads", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].threadUnreadReplyCount).toBe(0);
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("reports no unread reply count on search hits", async () => {
    messageFindManyMock.mockResolvedValue([
      { ...message(), id: PARENT_MESSAGE_ID, _count: { replies: 5 } },
    ]);
    queryRawUnsafeMock.mockResolvedValue([
      unreadThreadRow(PARENT_MESSAGE_ID, 2),
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=Hello`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: PARENT_MESSAGE_ID,
      threadReplyCount: 5,
      threadUnreadReplyCount: 0,
    });
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("reports the unread reply count inside an around window", async () => {
    const center = {
      ...message(),
      id: PARENT_MESSAGE_ID,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      _count: { replies: 4 },
    };
    messageFindFirstMock.mockResolvedValue(center);
    messageFindManyMock.mockResolvedValue([]);
    messageCountMock.mockResolvedValue(1);
    queryRawUnsafeMock.mockResolvedValue([
      unreadThreadRow(PARENT_MESSAGE_ID, 3),
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?around=${PARENT_MESSAGE_ID}&limit=3`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: PARENT_MESSAGE_ID,
        threadReplyCount: 4,
        threadUnreadReplyCount: 3,
      }),
    ]);
  });

  it("lists the thread's repliers newest first", async () => {
    messageFindManyMock.mockResolvedValue([
      {
        ...message(),
        _count: { replies: 3 },
        replies: [
          userReply("user_grace", "Grace", "2026-01-03T00:00:00.000Z"),
          coworkerReply("cow_1", "Scout", "2026-01-02T00:00:00.000Z"),
          userReply("user_linus", "Linus", "2026-01-01T12:00:00.000Z"),
        ],
      },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].threadLastReplyAt).toBe("2026-01-03T00:00:00.000Z");
    expect(body.data[0].threadRepliers).toEqual([
      {
        type: "user",
        user: expect.objectContaining({ id: "user_grace", name: "Grace" }),
      },
      {
        type: "coworker",
        coworker: expect.objectContaining({ id: "cow_1", name: "Scout" }),
      },
      {
        type: "user",
        user: expect.objectContaining({ id: "user_linus", name: "Linus" }),
      },
    ]);
  });

  it("caps the repliers at three and counts a repeat sender once", async () => {
    messageFindManyMock.mockResolvedValue([
      {
        ...message(),
        _count: { replies: 5 },
        replies: [
          userReply("user_grace", "Grace", "2026-01-05T00:00:00.000Z"),
          userReply("user_grace", "Grace", "2026-01-04T00:00:00.000Z"),
          userReply("user_linus", "Linus", "2026-01-03T00:00:00.000Z"),
          coworkerReply("cow_1", "Scout", "2026-01-02T00:00:00.000Z"),
          userReply("user_ada", "Ada", "2026-01-01T12:00:00.000Z"),
        ],
      },
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.data[0].threadRepliers.map(
        (replier: { user?: { id: string }; coworker?: { id: string } }) =>
          (replier.user ?? replier.coworker)?.id,
      ),
    ).toEqual(["user_grace", "user_linus", "cow_1"]);
  });

  it("lists no repliers on a message without replies", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].threadRepliers).toEqual([]);
  });

  it("reclaims stale mentions on the timeline path without q", async () => {
    listStaleSentChatRoomMentionIdsMock.mockResolvedValue([
      "550e8400-e29b-41d4-a716-446655440099",
    ]);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    expect(listStaleSentChatRoomMentionIdsMock).toHaveBeenCalledWith(ROOM_ID);
  });
});
