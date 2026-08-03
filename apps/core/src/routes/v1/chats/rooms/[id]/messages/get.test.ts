import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomMessages from "./get";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindManyMock,
  messageCountMock,
  prismaTransactionMock,
  listStaleSentChatRoomMentionIdsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
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
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_messages");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomMessages(app as unknown as OpenAPIHonoWithAuth);
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
  roomFindFirstMock.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
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

  it("filters by content when q is set and searches all thread depths", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/messages?q=Hello&parentMessageId=${MESSAGE_ID}`,
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
