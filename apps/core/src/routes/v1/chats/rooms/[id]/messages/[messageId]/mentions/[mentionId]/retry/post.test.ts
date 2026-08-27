import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { dispatchChatRoomMention } from "@/services/chat-room-coworker-dispatch.service";

import mountRetryChatRoomMention from "./post";

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
  messageFindUniqueOrThrowMock,
  mentionUpdateManyMock,
  mentionFindFirstMock,
  prismaTransactionMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindUniqueOrThrowMock: vi.fn(),
  mentionUpdateManyMock: vi.fn(),
  mentionFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  waitUntilMock: vi.fn(),
}));

vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const MENTION_ID = "550e8400-e29b-41d4-a716-446655440002";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const COWORKER_ID = "cow_123";

const tx = {
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
    findUniqueOrThrow: messageFindUniqueOrThrowMock,
  },
  chatRoomMention: {
    updateMany: mentionUpdateManyMock,
    findFirst: mentionFindFirstMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountRetryChatRoomMention(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

const otherUserAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: OTHER_USER_ID,
  organizationId: "org_1",
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
};

const pendingMention = {
  id: MENTION_ID,
  coworkerId: COWORKER_ID,
  status: "pending",
  responseMessageId: null,
};

const mappedMessage = {
  id: MESSAGE_ID,
  roomId: ROOM_ID,
  parentMessageId: null,
  content: "hello @hannah",
  createdAt: new Date("2026-07-01T12:00:00.000Z"),
  deletedAt: null,
  editedAt: null,
  senderUserId: USER_ID,
  senderCoworkerId: null,
  metadata: null,
  senderUser: {
    id: USER_ID,
    name: "Ada",
    email: "ada@example.com",
    image: null,
  },
  senderCoworker: null,
  mentionsAsSource: [pendingMention],
  reactions: [],
  _count: { replies: 0 },
  replies: [],
};

async function retryMention(auth = userAuthContext) {
  const app = createApp(auth);
  return app.request(
    `/${ROOM_ID}/messages/${MESSAGE_ID}/mentions/${MENTION_ID}/retry`,
    { method: "POST" },
  );
}

describe("POST /chats/rooms/:id/messages/:messageId/mentions/:mentionId/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
      name: "general",
      archivedAt: null,
      userMembers: [{ userId: USER_ID }],
      coworkerMembers: [],
    });
    organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
    memberFindUniqueMock.mockResolvedValue({
      id: "member_1",
      userId: USER_ID,
      organizationId: "org_1",
      role: "member",
    });
    messageFindFirstMock.mockResolvedValue({
      id: MESSAGE_ID,
      deletedAt: null,
      senderUserId: USER_ID,
      metadata: null,
    });
    mentionUpdateManyMock.mockResolvedValue({ count: 1 });
    mentionFindFirstMock.mockResolvedValue(null);
    messageFindUniqueOrThrowMock.mockResolvedValue(mappedMessage);
    waitUntilMock.mockImplementation(() => {});
  });

  it("resets a failed mention to pending, publishes status, and redispatches", async () => {
    const response = await retryMention();

    expect(response.status).toBe(200);
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: MENTION_ID,
        messageId: MESSAGE_ID,
        status: "failed",
      },
      data: {
        status: "pending",
        error: null,
      },
    });
    expect(waitUntilMock).toHaveBeenCalled();
    expect(dispatchChatRoomMention).toHaveBeenCalledWith(MENTION_ID);
    expect(publishChatRoomMessageRealtime).toHaveBeenCalledWith(
      mappedMessage,
      "mention_status",
    );

    const body = await response.json();
    expect(body.data.mentions).toEqual([
      {
        id: MENTION_ID,
        coworkerId: COWORKER_ID,
        status: "pending",
        responseMessageId: null,
      },
    ]);
  });

  it("returns 403 when a non-mentioner retries", async () => {
    const response = await retryMention(otherUserAuthContext);

    expect(response.status).toBe(403);
    expect(mentionUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchChatRoomMention).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker actors", async () => {
    const response = await retryMention(coworkerAuthContext);

    expect(response.status).toBe(403);
    expect(mentionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the mention is missing", async () => {
    mentionUpdateManyMock.mockResolvedValue({ count: 0 });
    mentionFindFirstMock.mockResolvedValue(null);

    const response = await retryMention();

    expect(response.status).toBe(404);
    expect(dispatchChatRoomMention).not.toHaveBeenCalled();
  });

  it("returns 409 when the mention is not failed", async () => {
    mentionUpdateManyMock.mockResolvedValue({ count: 0 });
    mentionFindFirstMock.mockResolvedValue({
      id: MENTION_ID,
      status: "sent",
    });

    const response = await retryMention();

    expect(response.status).toBe(409);
    expect(dispatchChatRoomMention).not.toHaveBeenCalled();
  });

  it("returns 400 when the source message is deleted", async () => {
    messageFindFirstMock.mockResolvedValue({
      id: MESSAGE_ID,
      deletedAt: new Date("2026-07-01T12:01:00.000Z"),
      senderUserId: USER_ID,
      metadata: null,
    });

    const response = await retryMention();

    expect(response.status).toBe(400);
    expect(mentionUpdateManyMock).not.toHaveBeenCalled();
    expect(dispatchChatRoomMention).not.toHaveBeenCalled();
  });

  it("returns 400 for a membership status message", async () => {
    messageFindFirstMock.mockResolvedValue({
      id: MESSAGE_ID,
      deletedAt: null,
      senderUserId: USER_ID,
      metadata: {
        membership: {
          action: "joined",
          subject: { type: "user", id: USER_ID, name: "Ada" },
        },
      },
    });

    const response = await retryMention();

    expect(response.status).toBe(400);
    expect(mentionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the message is missing", async () => {
    messageFindFirstMock.mockResolvedValue(null);

    const response = await retryMention();

    expect(response.status).toBe(404);
    expect(mentionUpdateManyMock).not.toHaveBeenCalled();
  });
});
