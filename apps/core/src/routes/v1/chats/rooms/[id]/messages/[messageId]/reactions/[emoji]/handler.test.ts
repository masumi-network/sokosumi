import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomMessageReaction from "./delete";
import mountPutChatRoomMessageReaction from "./put";

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
  reactionCreateManyMock,
  reactionDeleteManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindUniqueOrThrowMock: vi.fn(),
  reactionCreateManyMock: vi.fn(),
  reactionDeleteManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoom: { findFirst: roomFindFirstMock },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
    findUniqueOrThrow: messageFindUniqueOrThrowMock,
  },
  chatRoomReaction: {
    createMany: reactionCreateManyMock,
    deleteMany: reactionDeleteManyMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_message_reaction");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountPutChatRoomMessageReaction(app);
  mountDeleteChatRoomMessageReaction(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function storedMessage(reactions: Array<{ emoji: string; userId: string }>) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "hello",
    metadata: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    senderUserId: "user_other",
    senderCoworkerId: null,
    senderSokoBotId: null,
    senderUser: {
      id: "user_other",
      name: "Grace",
      email: "grace@example.com",
      image: null,
    },
    senderCoworker: null,
    senderSokoBot: null,
    mentionsAsSource: [],
    reactions: reactions.map((reaction) => ({
      ...reaction,
      user: { id: reaction.userId, name: "Ada" },
    })),
    replies: [],
    pins: [],
    _count: { replies: 0 },
  };
}

function reactionPath(emoji: string) {
  return `/${ROOM_ID}/messages/${MESSAGE_ID}/reactions/${encodeURIComponent(emoji)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  roomFindFirstMock.mockResolvedValue({
    id: ROOM_ID,
    organizationId: ORG_ID,
    kind: "channel",
    userMembers: [{ access: "member" }],
  });
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({
    id: "member_1",
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "member",
  });
  messageFindFirstMock.mockResolvedValue({ deletedAt: null, metadata: null });
  reactionCreateManyMock.mockResolvedValue({ count: 1 });
  reactionDeleteManyMock.mockResolvedValue({ count: 1 });
  messageFindUniqueOrThrowMock.mockResolvedValue(
    storedMessage([{ emoji: "👍", userId: USER_ID }]),
  );
});

describe("PUT /chats/rooms/{id}/messages/{messageId}/reactions/{emoji}", () => {
  it.each([
    ["a plain emoji", "👍"],
    ["an emoji with a variation selector", "❤️"],
    ["a ZWJ sequence", "👨‍👩‍👧"],
  ])("adds %s decoded from the path", async (_label, emoji) => {
    const response = await createApp(userAuthContext).request(
      reactionPath(emoji),
      { method: "PUT" },
    );

    expect(response.status).toBe(200);
    expect(reactionCreateManyMock).toHaveBeenCalledWith({
      data: { messageId: MESSAGE_ID, userId: USER_ID, emoji },
      skipDuplicates: true,
    });
    expect(reactionDeleteManyMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtime).toHaveBeenCalledWith(
      expect.objectContaining({ id: MESSAGE_ID }),
      "reaction",
    );
  });

  it("returns the message viewed by the caller", async () => {
    const response = await createApp(userAuthContext).request(
      reactionPath("👍"),
      { method: "PUT" },
    );

    const body = await response.json();
    expect(body.data.reactions).toEqual([
      {
        emoji: "👍",
        count: 1,
        reactedByCurrentUser: true,
        reactors: [{ id: USER_ID, name: "Ada" }],
      },
    ]);
  });

  it("is idempotent and publishes nothing when the reaction already exists", async () => {
    reactionCreateManyMock.mockResolvedValue({ count: 0 });

    const response = await createApp(userAuthContext).request(
      reactionPath("👍"),
      { method: "PUT" },
    );

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtime).not.toHaveBeenCalled();
  });

  it.each(["PUT", "DELETE"] as const)(
    "rejects a reaction on a deleted message on %s",
    async (method) => {
      messageFindFirstMock.mockResolvedValue({
        deletedAt: new Date("2026-09-02T00:00:00.000Z"),
        metadata: null,
      });

      const response = await createApp(userAuthContext).request(
        reactionPath("👍"),
        { method },
      );

      expect(response.status).toBe(400);
      expect(reactionCreateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "rejects a reaction on a membership status message on %s",
    async (method) => {
      messageFindFirstMock.mockResolvedValue({
        deletedAt: null,
        metadata: {
          membership: {
            action: "joined",
            subject: { type: "user", id: USER_ID, name: "Ada" },
          },
        },
      });

      const response = await createApp(userAuthContext).request(
        reactionPath("👍"),
        { method },
      );

      expect(response.status).toBe(400);
      expect(reactionCreateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "404s when the message is not in the room on %s",
    async (method) => {
      messageFindFirstMock.mockResolvedValue(null);

      const response = await createApp(userAuthContext).request(
        reactionPath("👍"),
        { method },
      );

      expect(response.status).toBe(404);
      expect(reactionCreateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "rejects an emoji longer than 24 characters on %s",
    async (method) => {
      const response = await createApp(userAuthContext).request(
        reactionPath("x".repeat(25)),
        { method },
      );

      expect(response.status).toBe(422);
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "rejects coworker actors on %s",
    async (method) => {
      const response = await createApp({
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: "01960001-0001-7001-8001-000000000001",
        context: { userId: USER_ID, organizationId: ORG_ID },
      }).request(reactionPath("👍"), { method });

      expect(response.status).toBe(403);
      expect(reactionCreateManyMock).not.toHaveBeenCalled();
    },
  );
});

describe("DELETE /chats/rooms/{id}/messages/{messageId}/reactions/{emoji}", () => {
  it.each([
    ["a plain emoji", "👍"],
    ["an emoji with a variation selector", "❤️"],
    ["a ZWJ sequence", "👨‍👩‍👧"],
  ])(
    "removes only the caller's %s decoded from the path",
    async (_label, emoji) => {
      messageFindUniqueOrThrowMock.mockResolvedValue(storedMessage([]));

      const response = await createApp(userAuthContext).request(
        reactionPath(emoji),
        { method: "DELETE" },
      );

      expect(response.status).toBe(200);
      expect(reactionDeleteManyMock).toHaveBeenCalledWith({
        where: { messageId: MESSAGE_ID, userId: USER_ID, emoji },
      });
      expect(reactionCreateManyMock).not.toHaveBeenCalled();
      expect(publishChatRoomMessageRealtime).toHaveBeenCalledWith(
        expect.objectContaining({ id: MESSAGE_ID }),
        "reaction",
      );
      const body = await response.json();
      expect(body.data.reactions).toEqual([]);
    },
  );

  it("is idempotent and publishes nothing when there was no reaction", async () => {
    reactionDeleteManyMock.mockResolvedValue({ count: 0 });

    const response = await createApp(userAuthContext).request(
      reactionPath("👍"),
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtime).not.toHaveBeenCalled();
  });
});
