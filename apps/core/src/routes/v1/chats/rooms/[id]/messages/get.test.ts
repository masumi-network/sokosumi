import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  listStaleSentChatRoomMentionIdsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCountMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
  },
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  listStaleSentChatRoomMentionIds: (...args: unknown[]) =>
    listStaleSentChatRoomMentionIdsMock(...args),
  dispatchChatRoomMention: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
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
    replies: [],
    _count: { replies: 0 },
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
  listStaleSentChatRoomMentionIdsMock.mockResolvedValue([]);
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
