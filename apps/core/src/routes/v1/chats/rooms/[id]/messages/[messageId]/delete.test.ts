import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomMessage from "./delete";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  messageUpdateManyMock,
  mentionUpdateManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageUpdateManyMock: vi.fn(),
  mentionUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const {
  publishChatRoomMessageRealtimeMock,
  publishChatRoomMessageRealtimeByIdMock,
} = vi.hoisted(() => ({
  publishChatRoomMessageRealtimeMock: vi.fn().mockResolvedValue(undefined),
  publishChatRoomMessageRealtimeByIdMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
  publishChatRoomMessageRealtimeById: publishChatRoomMessageRealtimeByIdMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";

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
    updateMany: messageUpdateManyMock,
  },
  chatRoomMention: {
    updateMany: mentionUpdateManyMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountDeleteChatRoomMessage(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "secret oops",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    deletedAt: null,
    senderUserId: USER_ID,
    senderCoworkerId: null,
    metadata: { quote: { messageId: "x" } },
    senderUser: {
      id: USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    _count: { replies: 0 },
    replies: [],
    ...overrides,
  };
}

describe("DELETE /chat-rooms/:id/messages/:messageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
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
    const live = baseMessage();
    const tombstone = baseMessage({
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    // Auth load then post-update reload.
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(tombstone);
    messageUpdateManyMock.mockResolvedValue({ count: 1 });
    mentionUpdateManyMock.mockResolvedValue({ count: 0 });
  });

  it("soft-deletes the author message and returns a tombstone", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.content).toBe("");
    expect(body.data.deletedAt).toBeTruthy();
    expect(messageUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          deletedAt: null,
        },
        data: expect.objectContaining({
          content: "",
          metadata: null,
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        messageId: MESSAGE_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
  });

  it("returns 403 when a different member tries to delete", async () => {
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(
      baseMessage({ senderUserId: OTHER_USER_ID }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the author deletes an already-deleted message", async () => {
    const tombstone = baseMessage({
      content: "",
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(tombstone);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        messageId: MESSAGE_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
    const body = await response.json();
    expect(body.data.deletedAt).toBeTruthy();
    expect(body.data.content).toBe("");
  });

  it("does not re-publish parent on idempotent re-delete of a reply", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const tombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(tombstone);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("re-publishes the thread parent when a reply is soft-deleted", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const live = baseMessage({ parentMessageId: parentId });
    const replyTombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(replyTombstone);
    messageUpdateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      replyTombstone,
      "delete",
    );
    expect(publishChatRoomMessageRealtimeByIdMock).toHaveBeenCalledWith(
      parentId,
      "update",
    );
  });

  it("does not re-publish parent when concurrent delete loses the tombstone race", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const live = baseMessage({ parentMessageId: parentId });
    const replyTombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(replyTombstone);
    // Another request already wrote deletedAt — conditional update matches 0 rows.
    messageUpdateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          deletedAt: null,
        },
      }),
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      replyTombstone,
      "delete",
    );
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("does not re-publish a parent when a top-level message is deleted", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the message is missing", async () => {
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });
});
