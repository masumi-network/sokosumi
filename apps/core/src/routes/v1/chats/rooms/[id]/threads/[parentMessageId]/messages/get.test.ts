import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRoomThreadMessages from "./get";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  messageFindManyMock,
  messageCountMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCountMock: vi.fn(),
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
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const REPLY_ID = "550e8400-e29b-41d4-a716-446655440002";
const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_chat_room_thread_messages");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetChatRoomThreadMessages(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function replyMessage() {
  return {
    id: REPLY_ID,
    roomId: ROOM_ID,
    parentMessageId: PARENT_ID,
    content: "Thread reply",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
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
  messageFindFirstMock.mockResolvedValue({ id: PARENT_ID });
  messageFindManyMock.mockResolvedValue([replyMessage()]);
  messageCountMock.mockResolvedValue(1);
});

describe("GET /chats/rooms/{id}/threads/{parentMessageId}/messages", () => {
  it("returns thread replies when the parent exists", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/messages`,
    );

    expect(response.status).toBe(200);
    expect(roomFindFirstMock).toHaveBeenCalledOnce();
    expect(messageFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: PARENT_ID,
        roomId: ROOM_ID,
        parentMessageId: null,
      },
      select: { id: true },
    });
    expect(messageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId: ROOM_ID,
          parentMessageId: PARENT_ID,
        },
      }),
    );
    expect(messageCountMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        parentMessageId: PARENT_ID,
      },
    });

    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: REPLY_ID,
        roomId: ROOM_ID,
        parentMessageId: PARENT_ID,
        content: "Thread reply",
      }),
    ]);
  });

  it("returns 404 when the parent message is missing", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      `/${ROOM_ID}/threads/${PARENT_ID}/messages`,
    );

    expect(response.status).toBe(404);
    expect(messageFindManyMock).not.toHaveBeenCalled();
    expect(messageCountMock).not.toHaveBeenCalled();
  });
});
