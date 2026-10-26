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
  messageGroupByMock,
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
  messageGroupByMock: vi.fn(),
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
      groupBy: messageGroupByMock,
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

/** Live reply counts by parent, as the grouped reply read returns them. */
function replyCounts(counts: Record<string, number>) {
  messageGroupByMock.mockResolvedValue(
    Object.entries(counts).map(([parentMessageId, all]) => ({
      parentMessageId,
      _count: { _all: all },
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  messageFindFirstMock.mockReset();
  messageFindManyMock.mockReset();
  messageCountMock.mockReset();
  messageGroupByMock.mockResolvedValue([]);
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

  it("keeps staged mentions private until activation without widening the public enum", async () => {
    const mention = {
      id: "550e8400-e29b-41d4-a716-446655440031",
      coworkerId: null,
      sokoBotId: "550e8400-e29b-41d4-a716-446655440032",
      responseMessageId: null,
      status: "staged",
    };
    const stagedMessage = {
      ...message(),
      content: "",
      deletedAt: new Date("2026-01-04T00:00:00.000Z"),
      metadata: { private_delivery_instruction: "Do not publish yet" },
      mentionsAsSource: [mention],
    };
    messageFindManyMock.mockResolvedValue([stagedMessage]);
    const app = createApp(userAuthContext);
    const hiddenResponse = await app.request(`/${ROOM_ID}/messages`);
    expect(hiddenResponse.status).toBe(200);
    const hidden = await hiddenResponse.json();
    // Main's history contract keeps deletion tombstones, never their payload.
    expect(hidden.data[0]).toMatchObject({
      id: MESSAGE_ID,
      content: "",
      metadata: null,
      mentions: [],
      deletedAt: "2026-01-04T00:00:00.000Z",
    });
    expect(JSON.stringify(hidden)).not.toContain("staged");
    expect(JSON.stringify(hidden)).not.toContain("Do not publish yet");

    messageFindManyMock.mockResolvedValue([
      {
        ...stagedMessage,
        content: "Synthetic activated reply",
        deletedAt: null,
        metadata: null,
        mentionsAsSource: [{ ...mention, status: "pending" }],
      },
    ]);
    const activatedResponse = await app.request(`/${ROOM_ID}/messages`);
    expect(activatedResponse.status).toBe(200);
    const activated = await activatedResponse.json();
    expect(activated.data[0]).toMatchObject({
      content: "Synthetic activated reply",
      deletedAt: null,
      mentions: [{ ...mention, status: "pending" }],
    });
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
    };
    // A busy thread the viewer only lurks in: no aggregate row comes back for
    // it, so it must read 0 rather than its reply count.
    const lurkedParent = {
      ...message(),
      id: OLDER_MESSAGE_ID,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    messageFindManyMock.mockResolvedValue([unreadParent, lurkedParent]);
    messageCountMock.mockResolvedValue(2);
    replyCounts({ [PARENT_MESSAGE_ID]: 5, [OLDER_MESSAGE_ID]: 20 });
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
    // Only the Unread divider's query runs; no thread aggregate.
    expect(queryRawUnsafeMock).toHaveBeenCalledOnce();
    expect(String(queryRawUnsafeMock.mock.calls[0]?.[0])).not.toContain(
      "chat_room_thread_read_state",
    );
  });

  it("reports no unread reply count on search hits", async () => {
    messageFindManyMock.mockResolvedValue([
      { ...message(), id: PARENT_MESSAGE_ID },
    ]);
    replyCounts({ [PARENT_MESSAGE_ID]: 5 });
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
    };
    messageFindFirstMock.mockResolvedValue(center);
    messageFindManyMock.mockResolvedValue([]);
    messageCountMock.mockResolvedValue(1);
    replyCounts({ [PARENT_MESSAGE_ID]: 4 });
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

  it("lists the thread's repliers in the order they first replied", async () => {
    messageFindManyMock.mockResolvedValue([
      {
        ...message(),
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
        user: expect.objectContaining({ id: "user_linus", name: "Linus" }),
      },
      {
        type: "coworker",
        coworker: expect.objectContaining({ id: "cow_1", name: "Scout" }),
      },
      {
        type: "user",
        user: expect.objectContaining({ id: "user_grace", name: "Grace" }),
      },
    ]);
  });

  it("caps the repliers at three and counts a repeat sender once", async () => {
    messageFindManyMock.mockResolvedValue([
      {
        ...message(),
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
    ).toEqual(["user_ada", "cow_1", "user_linus"]);
  });

  it("lists no repliers on a message without replies", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].threadRepliers).toEqual([]);
  });

  describe("Unread divider", () => {
    const FIRST_UNREAD_ID = "550e8400-e29b-41d4-a716-446655440050";
    const FIRST_UNREAD_AT = "2026-01-10T00:00:00.000Z";

    /** A top-level message `day` days into January, id ending in `suffix`. */
    function topLevel(suffix: number, day: number) {
      return {
        ...message(),
        id: `550e8400-e29b-41d4-a716-4466554400${String(suffix).padStart(2, "0")}`,
        createdAt: new Date(
          `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
        ),
      };
    }

    /**
     * The database answers the first-unread query with `firstUnread`, and the
     * thread aggregate query with nothing.
     */
    function firstUnreadIs(
      firstUnread: { id: string; createdAt: Date } | null,
    ) {
      queryRawUnsafeMock.mockImplementation(async (sql: string) =>
        sql.includes("chat_room_thread_read_state") || !firstUnread
          ? []
          : [firstUnread],
      );
    }

    function firstUnreadSql(): string {
      const call = queryRawUnsafeMock.mock.calls.find(
        ([sql]) => !String(sql).includes("chat_room_thread_read_state"),
      );
      return String(call?.[0]);
    }

    async function get(query: string) {
      const response = await createApp(userAuthContext).request(
        `/${ROOM_ID}/messages${query}`,
      );
      expect(response.status).toBe(200);
      return response.json();
    }

    it("names the first unread message on the plain newest page", async () => {
      const firstUnread = { ...topLevel(50, 10) };
      messageFindManyMock.mockResolvedValue([firstUnread, topLevel(10, 1)]);
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get("");

      expect(body.meta.pagination.firstUnreadMessageId).toBe(FIRST_UNREAD_ID);
    });

    it("answers null on the plain newest page when nothing is Room unread", async () => {
      firstUnreadIs(null);

      const body = await get("");

      expect(body.meta.pagination.firstUnreadMessageId).toBeNull();
    });

    it("names the first unread message on an around window", async () => {
      messageFindFirstMock.mockResolvedValue(message());
      messageFindManyMock.mockResolvedValue([]);
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get(`?around=${MESSAGE_ID}`);

      expect(body.meta.pagination.firstUnreadMessageId).toBe(FIRST_UNREAD_ID);
    });

    it("leaves older pages and search hits without a first unread message", async () => {
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const older = await get(`?cursor=${OLDER_MESSAGE_ID}`);
      const search = await get("?q=Hello");

      expect(older.meta.pagination).not.toHaveProperty("firstUnreadMessageId");
      expect(search.meta.pagination).not.toHaveProperty("firstUnreadMessageId");
      expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    });

    it("opens at the newest page when the first unread message is on it", async () => {
      messageFindManyMock.mockResolvedValue([
        topLevel(51, 11),
        topLevel(50, 10),
        topLevel(10, 1),
      ]);
      messageCountMock.mockResolvedValue(3);
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get("?openAtUnread=true&limit=100");

      expect(body.data.map((row: { id: string }) => row.id)).toEqual([
        topLevel(10, 1).id,
        FIRST_UNREAD_ID,
        topLevel(51, 11).id,
      ]);
      expect(body.meta.pagination).toMatchObject({
        firstUnreadMessageId: FIRST_UNREAD_ID,
        nextCursor: null,
      });
      expect(messageFindManyMock).toHaveBeenCalledOnce();
    });

    it("opens at three read messages above an older first unread message and thirty from it", async () => {
      // Newest page of 5: the first unread message is further back.
      const newestPage = [95, 94, 93, 92, 91, 90].map((suffix, index) =>
        topLevel(suffix, 28 - index),
      );
      // Four older rows come back for three places: more history above.
      const above = [4, 3, 2, 1].map((suffix) => topLevel(suffix, 5 + suffix));
      const fromFirst = [
        topLevel(50, 10),
        ...Array.from({ length: 29 }, (_, index) => topLevel(60 + index, 11)),
      ];
      messageFindManyMock.mockImplementation(
        async (args: {
          where: { AND?: unknown };
          orderBy: Array<{ createdAt: string }>;
        }) => {
          if (!args.where.AND) {
            return newestPage;
          }
          return args.orderBy[0]?.createdAt === "asc" ? fromFirst : above;
        },
      );
      messageCountMock.mockResolvedValue(200);
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get("?openAtUnread=true&limit=5");

      const ids = body.data.map((row: { id: string }) => row.id);
      expect(ids.slice(0, 4)).toEqual([
        topLevel(2, 7).id,
        topLevel(3, 8).id,
        topLevel(4, 9).id,
        FIRST_UNREAD_ID,
      ]);
      expect(ids).toHaveLength(33);
      expect(body.meta.pagination).toMatchObject({
        firstUnreadMessageId: FIRST_UNREAD_ID,
        nextCursor: topLevel(2, 7).id,
        total: 200,
      });
      const windowQueries = messageFindManyMock.mock.calls
        .map(([args]) => args)
        .filter((args) => args.where.AND);
      expect(windowQueries).toEqual([
        expect.objectContaining({
          take: 4,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        expect.objectContaining({
          take: 30,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);
      expect(JSON.stringify(windowQueries)).toContain(FIRST_UNREAD_AT);
    });

    it("gives no older cursor when nothing is above the window", async () => {
      messageFindManyMock.mockImplementation(
        async (args: {
          where: { AND?: unknown };
          orderBy: Array<{ createdAt: string }>;
        }) => {
          if (!args.where.AND) {
            return [topLevel(91, 20), topLevel(90, 19)];
          }
          return args.orderBy[0]?.createdAt === "asc"
            ? [topLevel(50, 10)]
            : [topLevel(1, 6)];
        },
      );
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get("?openAtUnread=true&limit=1");

      expect(body.data.map((row: { id: string }) => row.id)).toEqual([
        topLevel(1, 6).id,
        FIRST_UNREAD_ID,
      ]);
      expect(body.meta.pagination.nextCursor).toBeNull();
    });

    it("opens at the newest page with no divider when nothing is Room unread", async () => {
      messageFindManyMock.mockResolvedValue([topLevel(11, 2), topLevel(10, 1)]);
      firstUnreadIs(null);

      const body = await get("?openAtUnread=true");

      expect(body.data.map((row: { id: string }) => row.id)).toEqual([
        topLevel(10, 1).id,
        topLevel(11, 2).id,
      ]);
      expect(body.meta.pagination.firstUnreadMessageId).toBeNull();
      expect(messageFindManyMock).toHaveBeenCalledOnce();
    });

    it("places the divider by Room unread's own rules", async () => {
      firstUnreadIs(null);

      await get("?openAtUnread=true");

      const sql = firstUnreadSql();
      expect(queryRawUnsafeMock).toHaveBeenCalledWith(sql, ROOM_ID, USER_ID);
      // Top-level only: Thread replies, and User mentions inside a Thread,
      // never place it.
      expect(sql).toContain('message."parentMessageId" IS NULL');
      expect(sql).not.toContain("chat_room_user_mention");
      // Never the viewer's own message.
      expect(sql).toContain('message."senderUserId" <> $2');
      // Newer than Room last-read, which joining the room sets, so messages
      // from before the viewer joined never place it.
      expect(sql).toMatch(
        /> COALESCE\(read_state\."lastReadAt", '-infinity'::timestamp\)/,
      );
      // Marked unread names no message.
      expect(sql).not.toContain("markedUnreadAt");
      expect(sql).toContain('message."deletedAt" IS NULL');
      expect(sql).toMatch(
        /ORDER BY message\."createdAt" ASC, message\.id ASC\s+LIMIT 1/,
      );
    });

    it("gives a Guest on an External channel the same divider as a member", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        organizationId: ORG_ID,
        kind: "channel",
        userMembers: [{ access: "guest" }],
      });
      memberFindUniqueMock.mockResolvedValue(null);
      messageFindManyMock.mockResolvedValue([topLevel(50, 10)]);
      firstUnreadIs({
        id: FIRST_UNREAD_ID,
        createdAt: new Date(FIRST_UNREAD_AT),
      });

      const body = await get("?openAtUnread=true");

      expect(body.meta.pagination.firstUnreadMessageId).toBe(FIRST_UNREAD_ID);
      expect(queryRawUnsafeMock).toHaveBeenCalledWith(
        expect.any(String),
        ROOM_ID,
        USER_ID,
      );
    });

    it.each([
      ["q", "q=Hello"],
      ["cursor", `cursor=${OLDER_MESSAGE_ID}`],
      ["around", `around=${MESSAGE_ID}`],
    ])("rejects openAtUnread combined with %s", async (_, query) => {
      const response = await createApp(userAuthContext).request(
        `/${ROOM_ID}/messages?openAtUnread=true&${query}`,
      );

      expect(response.status).toBe(422);
      expect(messageFindFirstMock).not.toHaveBeenCalled();
      expect(messageFindManyMock).not.toHaveBeenCalled();
    });
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
