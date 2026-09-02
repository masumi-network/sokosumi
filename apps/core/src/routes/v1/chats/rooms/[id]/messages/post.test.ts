import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostRoomMessage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomUpdateMock,
  messageFindFirstMock,
  messageFindUniqueMock,
  messageFindManyMock,
  messageCreateMock,
  membershipFindManyMock,
  readStateUpsertMock,
  threadReadUpsertMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
  dispatchMock,
  emitChatMentionNotificationsMock,
  emitChatDirectMessageNotificationsMock,
  emitChatRoomMessageNotificationsMock,
  waitUntilMock,
  scheduleUnfurlsMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCreateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  dispatchMock: vi.fn(),
  emitChatMentionNotificationsMock: vi.fn(),
  emitChatDirectMessageNotificationsMock: vi.fn(),
  emitChatRoomMessageNotificationsMock: vi.fn(),
  waitUntilMock: vi.fn(),
  scheduleUnfurlsMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
    chatRoomMessage: {
      findUnique: messageFindUniqueMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: dispatchMock,
}));

vi.mock("@/services/chat-room-message-unfurl.service", () => ({
  scheduleChatRoomMessageUnfurls: scheduleUnfurlsMock,
}));

vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: (...args: unknown[]) =>
    emitChatMentionNotificationsMock(...args),
}));

vi.mock(
  "@/helpers/chat-direct-message-notifications",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/helpers/chat-direct-message-notifications")
      >();
    return {
      ...actual,
      emitChatDirectMessageNotifications: (...args: unknown[]) =>
        emitChatDirectMessageNotificationsMock(...args),
    };
  },
);

vi.mock("@/helpers/chat-room-message-notifications", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/chat-room-message-notifications")
    >();
  return {
    ...actual,
    emitChatRoomMessageNotifications: (...args: unknown[]) =>
      emitChatRoomMessageNotificationsMock(...args),
  };
});

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const MENTION_ID = "550e8400-e29b-41d4-a716-446655440003";
const QUOTE_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440004";
const COWORKER_ID = "coworker_1";
const SOKO_BOT_ID = "01960001-0001-7001-8001-000000000099";
const USER_ID = "user_123";
const ALICE_ID = "user_alice";
const BOB_ID = "user_bob";

const quoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "Earlier point about launch risk",
  attachment: null,
};

const imageQuoteContent =
  "see this [launch.png](https://blob.example/launch.png)";
const imageQuoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "see this",
  attachment: {
    fileName: "launch.png",
    url: "https://blob.example/launch.png",
    mediaKind: "image" as const,
  },
};

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    update: roomUpdateMock,
  },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
    findUnique: messageFindUniqueMock,
    findMany: messageFindManyMock,
    create: messageCreateMock,
  },
  chatRoomReadState: {
    upsert: readStateUpsertMock,
  },
  chatRoomThreadReadState: {
    upsert: threadReadUpsertMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: "vendor_1",
};

const sokoBotAuthContext: AuthVariables["authContext"] = {
  actor: "sokoBot",
  sokoBotId: SOKO_BOT_ID,
  userId: USER_ID,
  workspaceId: "01960001-0001-7001-8001-000000000088",
  organizationId: "org_1",
};

function roomWithMembers(
  overrides: {
    kind?: "channel" | "direct";
    name?: string;
    userMembers?: Array<{
      userId: string;
      user: { name: string };
    }>;
    coworkerMembers?: Array<{
      coworker: {
        id: string;
        name: string;
        slug: string;
        caption: string | null;
        image: string | null;
      };
    }>;
    sokoBotMembers?: Array<{
      sokoBot: {
        id: string;
        name: string | null;
        avatarImageUrl: string | null;
        avatarSeed: string | null;
        userId: string;
        user: { name: string } | null;
      };
    }>;
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    name: overrides.name ?? "general",
    slug: "general",
    kind: overrides.kind ?? "channel",
    directKey: null,
    topic: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: overrides.userMembers ?? [],
    coworkerMembers: overrides.coworkerMembers ?? [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Hannah",
          slug: "hannah",
          caption: null,
          image: null,
        },
      },
    ],
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

function coworkerOnlyDirectRoom() {
  return {
    id: ROOM_ID,
    organizationId: null,
    name: "Hannah",
    slug: "hannah",
    kind: "direct",
    providerConversationId: "conv_remote_1",
    userMembers: [
      {
        userId: USER_ID,
        user: { name: "Patrick" },
      },
    ],
    coworkerMembers: [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Hannah",
          slug: "hannah",
        },
      },
    ],
    sokoBotMembers: [],
  };
}

function createdMessage(
  overrides: Partial<{
    senderUserId: string | null;
    senderCoworkerId: string | null;
    senderSokoBotId: string | null;
    parentMessageId: string | null;
    metadata: Record<string, unknown> | null;
    mentionsAsSource: Array<{
      id: string;
      coworkerId: string | null;
      sokoBotId: string | null;
      status: string;
      responseMessageId: string | null;
    }>;
  }> = {},
) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: overrides.parentMessageId ?? null,
    senderUserId: overrides.senderUserId ?? null,
    senderCoworkerId: overrides.senderCoworkerId ?? null,
    senderSokoBotId: overrides.senderSokoBotId ?? null,
    content: "hello",
    metadata: overrides.metadata ?? null,
    createdAt: new Date("2025-01-02T00:00:00.000Z"),
    editedAt: null,
    senderUser: overrides.senderUserId
      ? {
          id: overrides.senderUserId,
          name: "Patrick",
          email: "patrick@example.com",
          image: null,
          sessions: [],
        }
      : null,
    senderCoworker: overrides.senderCoworkerId
      ? {
          id: overrides.senderCoworkerId,
          name: "Hannah",
          slug: "hannah",
          caption: null,
          image: null,
        }
      : null,
    senderSokoBot: overrides.senderSokoBotId
      ? {
          id: overrides.senderSokoBotId,
          name: "Nora",
          avatarImageUrl: null,
          avatarSeed: null,
          userId: USER_ID,
          user: { name: "Patrick" },
        }
      : null,
    mentionsAsSource: overrides.mentionsAsSource ?? [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
  };
}

function quotedSourceMessage(
  overrides: Partial<{
    id: string;
    content: string;
    senderUserName: string | null;
    senderCoworkerName: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? QUOTE_MESSAGE_ID,
    content: overrides.content ?? "Earlier point about launch risk",
    senderUser:
      overrides.senderUserName === null
        ? null
        : {
            name: overrides.senderUserName ?? "Alice",
          },
    senderCoworker:
      overrides.senderCoworkerName != null
        ? { name: overrides.senderCoworkerName }
        : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomUpdateMock.mockResolvedValue({});
  readStateUpsertMock.mockResolvedValue({});
  threadReadUpsertMock.mockResolvedValue({
    parentMessageId: PARENT_MESSAGE_ID,
    lastReadAt: new Date("2026-07-02T12:00:00.000Z"),
  });
  messageFindUniqueMock.mockResolvedValue(null);
  emitChatMentionNotificationsMock.mockResolvedValue(undefined);
  scheduleUnfurlsMock.mockResolvedValue({
    messageId: MESSAGE_ID,
    attempted: 0,
    persisted: 0,
  });
  waitUntilMock.mockImplementation(() => {});
});

describe("POST /chats/rooms/{id}/messages", () => {
  describe("coworker actor", () => {
    it("lets a member coworker post as itself without mention rows", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        name: "general",
        kind: "channel",
        organizationId: "org_1",
        userMembers: [],
      });
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderCoworkerId: COWORKER_ID }),
      );

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.sender.type).toBe("coworker");
      expect(body.data.sender.coworker.id).toBe(COWORKER_ID);
      expect(body.data.mentions).toEqual([]);

      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderCoworkerId: COWORKER_ID,
            content: "hello",
          }),
        }),
      );
      const createData = messageCreateMock.mock.calls[0]?.[0]?.data;
      expect(createData?.mentionsAsSource).toBeUndefined();
      expect(createData?.senderUserId).toBeUndefined();
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(readStateUpsertMock).not.toHaveBeenCalled();
      expect(scheduleUnfurlsMock).toHaveBeenCalledWith(MESSAGE_ID);
      // The unfurl, and the room message the subscribed members asked for.
      expect(waitUntilMock).toHaveBeenCalledTimes(2);

      // Membership is enforced in the room lookup itself.
      expect(roomFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            coworkerMembers: { some: { coworkerId: COWORKER_ID } },
          }),
          select: expect.not.objectContaining({
            userMembers: expect.anything(),
          }),
        }),
      );
      expect(membershipFindManyMock).not.toHaveBeenCalled();
    });

    it("emits a CHAT Direct notification to the human in a coworker 1:1", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        name: "Hannah",
        kind: "direct",
        organizationId: "org_1",
      });
      membershipFindManyMock.mockResolvedValue([{ userId: ALICE_ID }]);
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderCoworkerId: COWORKER_ID }),
      );

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "you were assigned a task" }),
      });

      expect(response.status).toBe(201);
      expect(membershipFindManyMock).toHaveBeenCalledWith({
        where: { roomId: ROOM_ID },
        select: { userId: true },
      });
      expect(emitChatDirectMessageNotificationsMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        roomName: "Hannah",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: null,
        authorName: "Hannah",
        recipientUserIds: [ALICE_ID],
      });
      // Scheduled for every room. The emitter reads the roster and leaves a
      // direct room of two to the direct-message row, which is the only place
      // that decision can see how many humans are in it.
      expect(emitChatRoomMessageNotificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ roomKind: "direct" }),
      );
      expect(waitUntilMock).toHaveBeenCalledTimes(3);
    });

    it("emits a room message for coworker posts in a channel", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        name: "general",
        kind: "channel",
        organizationId: "org_1",
      });
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderCoworkerId: COWORKER_ID }),
      );

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello channel" }),
      });

      expect(response.status).toBe(201);
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
      expect(emitChatRoomMessageNotificationsMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        roomName: "general",
        roomKind: "channel",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: null,
        authorName: "Hannah",
      });
      expect(waitUntilMock).toHaveBeenCalledTimes(2);
    });

    it("rejects a coworker that is not a room member", async () => {
      roomFindFirstMock.mockResolvedValue(null);

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(response.status).toBe(404);
      expect(messageCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("soko bot actor", () => {
    it("posts with the soko bot sender after membership authorization", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        name: "general",
        kind: "channel",
        organizationId: "org_1",
      });
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderSokoBotId: SOKO_BOT_ID }),
      );

      const app = createApp(sokoBotAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(response.status).toBe(201);
      expect((await response.json()).data.sender.type).toBe("sokoBot");
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderCoworkerId: null,
            senderSokoBotId: SOKO_BOT_ID,
          }),
        }),
      );
      expect(roomFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sokoBotMembers: {
              some: { sokoBotId: SOKO_BOT_ID },
            },
          }),
        }),
      );
    });
  });

  describe("coworker-only directs", () => {
    it("creates a message without mention rows or dispatch", async () => {
      roomFindFirstMock.mockResolvedValue(coworkerOnlyDirectRoom());
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello coworker" }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.mentions).toEqual([]);

      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: { create: [] },
          }),
        }),
      );
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(scheduleUnfurlsMock).toHaveBeenCalledWith(MESSAGE_ID);
      // The unfurl, and the room message the subscribed members asked for.
      expect(waitUntilMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("room message notifications", () => {
    /**
     * The human path hands the emitter what it read inside the write
     * transaction: the roster the message was posted against, and the members
     * it named. Without the names, a mentioned reader is notified twice.
     */
    it("tells the emitter who was posted to and who was named", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          userMembers: [
            { userId: USER_ID, user: { name: "Patrick" } },
            { userId: ALICE_ID, user: { name: "Alice" } },
            { userId: BOB_ID, user: { name: "Bob" } },
          ],
          coworkerMembers: [],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello @alice" }),
      });

      expect(response.status).toBe(201);
      expect(emitChatRoomMessageNotificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: ROOM_ID,
          roomKind: "channel",
          authorUserId: USER_ID,
          memberUserIds: [USER_ID, ALICE_ID, BOB_ID],
          mentionedUserIds: [ALICE_ID],
        }),
      );
    });
  });

  describe("soko bot mentions", () => {
    it("creates a soko bot mention and dispatches a Soko Bot turn", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
          ],
          coworkerMembers: [],
          sokoBotMembers: [
            {
              sokoBot: {
                id: SOKO_BOT_ID,
                name: "Soko Bot",
                avatarImageUrl: null,
                avatarSeed: "orb:user_123",
                userId: USER_ID,
                user: { name: "Patrick" },
              },
            },
          ],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          mentionsAsSource: [
            {
              id: MENTION_ID,
              coworkerId: null,
              sokoBotId: SOKO_BOT_ID,
              status: "pending",
              responseMessageId: null,
            },
          ],
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `@sokoBot:${SOKO_BOT_ID} check the board`,
          mentionedSokoBotIds: [SOKO_BOT_ID],
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.mentions).toEqual([
        {
          id: MENTION_ID,
          coworkerId: null,
          sokoBotId: SOKO_BOT_ID,
          status: "pending",
          responseMessageId: null,
        },
      ]);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: {
              create: [{ coworkerId: null, sokoBotId: SOKO_BOT_ID }],
            },
          }),
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(MENTION_ID);
    });
  });

  describe("thread replies", () => {
    it("delivers a user thread reply to coworkers already in the thread", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindFirstMock.mockResolvedValue({
        id: PARENT_MESSAGE_ID,
        parentMessageId: null,
      });
      messageFindManyMock.mockResolvedValue([
        { senderCoworkerId: COWORKER_ID, mentionsAsSource: [] },
        {
          senderCoworkerId: null,
          mentionsAsSource: [{ coworkerId: "coworker_not_in_room" }],
        },
      ]);
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          parentMessageId: PARENT_MESSAGE_ID,
          mentionsAsSource: [
            {
              id: MENTION_ID,
              coworkerId: COWORKER_ID,
              sokoBotId: null,
              status: "pending",
              responseMessageId: null,
            },
          ],
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "no mention here",
          parentMessageId: PARENT_MESSAGE_ID,
        }),
      });

      expect(response.status).toBe(201);
      expect(threadReadUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_parentMessageId: {
              userId: USER_ID,
              parentMessageId: PARENT_MESSAGE_ID,
            },
          },
          update: { lastReadAt: new Date("2025-01-02T00:00:00.000Z") },
          create: {
            userId: USER_ID,
            parentMessageId: PARENT_MESSAGE_ID,
            lastReadAt: new Date("2025-01-02T00:00:00.000Z"),
          },
        }),
      );

      // The thread coworker became a mention target without an @mention;
      // the non-member coworker id from the thread was filtered out.
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: {
              create: [{ coworkerId: COWORKER_ID, sokoBotId: null }],
            },
          }),
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(MENTION_ID);
    });

    it("does not add coworkers for a top-level message without mentions", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "no mention here" }),
      });

      expect(response.status).toBe(201);
      expect(messageFindManyMock).not.toHaveBeenCalled();
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: { create: [] },
          }),
        }),
      );
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("accepts mentionedUserIds without creating ChatRoomMention rows", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
          ],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          mentionsAsSource: [
            {
              id: MENTION_ID,
              coworkerId: COWORKER_ID,
              sokoBotId: null,
              status: "pending",
              responseMessageId: null,
            },
          ],
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `@${COWORKER_ID}:hannah hey @user_alice:alice`,
          mentionedCoworkerIds: [COWORKER_ID],
          mentionedUserIds: [ALICE_ID, "user_outside"],
        }),
      });

      expect(response.status).toBe(201);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: {
              create: [{ coworkerId: COWORKER_ID, sokoBotId: null }],
            },
            userMentionsAsSource: {
              create: [{ userId: ALICE_ID }],
            },
          }),
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(MENTION_ID);
      expect(emitChatMentionNotificationsMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        roomName: "general",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: USER_ID,
        authorName: "Patrick",
        mentionedUserIds: [ALICE_ID],
      });
      expect(waitUntilMock).toHaveBeenCalledWith(expect.any(Promise));
      // coworker dispatch + human mention emit + unfurl scrape
      expect(waitUntilMock.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(scheduleUnfurlsMock).toHaveBeenCalledWith(MESSAGE_ID);
    });

    it("does not emit human mention notifications when nobody is mentioned", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "no mention here" }),
      });

      expect(response.status).toBe(201);
      expect(emitChatMentionNotificationsMock).not.toHaveBeenCalled();
      expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
      expect(scheduleUnfurlsMock).toHaveBeenCalledWith(MESSAGE_ID);
    });

    it("emits direct-message notifications to other humans in a direct room", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          kind: "direct",
          name: "Alice",
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
          ],
          coworkerMembers: [],
          sokoBotMembers: [],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hey, are you free?" }),
      });

      expect(response.status).toBe(201);
      expect(emitChatMentionNotificationsMock).not.toHaveBeenCalled();
      expect(emitChatDirectMessageNotificationsMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        roomName: "Alice",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: USER_ID,
        authorName: "Patrick",
        recipientUserIds: [ALICE_ID],
      });
    });

    it("skips direct-message emit for humans already covered by mention notifications", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          kind: "direct",
          name: "Alice",
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
          ],
          coworkerMembers: [],
          sokoBotMembers: [],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "ping",
          mentionedUserIds: [ALICE_ID],
        }),
      });

      expect(response.status).toBe(201);
      expect(emitChatMentionNotificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mentionedUserIds: [ALICE_ID],
        }),
      );
      expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
    });

    it("does not emit direct-message notifications for group directs", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          kind: "direct",
          name: "Group",
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
            {
              userId: BOB_ID,
              user: { name: "Bob" },
            },
          ],
          coworkerMembers: [],
          sokoBotMembers: [],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hey everyone" }),
      });

      expect(response.status).toBe(201);
      expect(emitChatMentionNotificationsMock).not.toHaveBeenCalled();
      expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
    });

    it("emits mention notifications but not direct-message notifications in group directs", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          kind: "direct",
          name: "Group",
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
            {
              userId: BOB_ID,
              user: { name: "Bob" },
            },
          ],
          coworkerMembers: [],
          sokoBotMembers: [],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "ping alice",
          mentionedUserIds: [ALICE_ID],
        }),
      });

      expect(response.status).toBe(201);
      expect(emitChatMentionNotificationsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mentionedUserIds: [ALICE_ID],
        }),
      );
      expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
    });

    it("expands @all:all from content to notify other humans without ChatRoomMention rows", async () => {
      roomFindFirstMock.mockResolvedValue(
        roomWithMembers({
          userMembers: [
            {
              userId: USER_ID,
              user: { name: "Patrick" },
            },
            {
              userId: ALICE_ID,
              user: { name: "Alice" },
            },
            {
              userId: BOB_ID,
              user: { name: "Bob" },
            },
          ],
        }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "**@all:all** please look",
        }),
      });

      expect(response.status).toBe(201);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: { create: [] },
          }),
        }),
      );
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(emitChatMentionNotificationsMock).toHaveBeenCalledWith({
        roomId: ROOM_ID,
        roomName: "general",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: USER_ID,
        authorName: "Patrick",
        mentionedUserIds: expect.arrayContaining([ALICE_ID, BOB_ID]),
      });
      const emitArgs = emitChatMentionNotificationsMock.mock.calls[0]?.[0] as {
        mentionedUserIds: string[];
      };
      expect(emitArgs.mentionedUserIds).toHaveLength(2);
      expect(emitArgs.mentionedUserIds).not.toContain(USER_ID);
      expect(emitArgs.mentionedUserIds).not.toContain(COWORKER_ID);
    });
  });

  describe("clientMessageId idempotency", () => {
    const CLIENT_MESSAGE_ID = "client-msg-dedup-1";

    it("includes clientMessageId on create when provided", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindUniqueMock.mockResolvedValue(null);
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          metadata: { client_message_id: CLIENT_MESSAGE_ID },
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "hello once",
          clientMessageId: CLIENT_MESSAGE_ID,
        }),
      });

      expect(response.status).toBe(201);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientMessageId: CLIENT_MESSAGE_ID,
            metadata: expect.objectContaining({
              client_message_id: CLIENT_MESSAGE_ID,
            }),
          }),
        }),
      );
      expect(publishChatRoomMessageRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            client_message_id: CLIENT_MESSAGE_ID,
          }),
        }),
        "create",
      );
    });

    it("returns the existing message for the same clientMessageId without recreating or re-dispatching", async () => {
      const existing = createdMessage({
        senderUserId: USER_ID,
        mentionsAsSource: [
          {
            id: MENTION_ID,
            coworkerId: COWORKER_ID,
            sokoBotId: null,
            status: "pending",
            responseMessageId: null,
          },
        ],
      });

      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindUniqueMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      messageCreateMock.mockResolvedValue(existing);

      const app = createApp(userAuthContext);
      const first = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `@${COWORKER_ID}:hannah hello`,
          mentionedCoworkerIds: [COWORKER_ID],
          clientMessageId: CLIENT_MESSAGE_ID,
        }),
      });
      expect(first.status).toBe(201);
      expect(messageCreateMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledTimes(1);

      const second = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `@${COWORKER_ID}:hannah hello`,
          mentionedCoworkerIds: [COWORKER_ID],
          clientMessageId: CLIENT_MESSAGE_ID,
        }),
      });
      expect(second.status).toBe(201);
      const secondBody = await second.json();
      expect(secondBody.data.id).toBe(MESSAGE_ID);
      expect(messageCreateMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      // Idempotent hit must not re-schedule unfurls
      expect(scheduleUnfurlsMock).toHaveBeenCalledTimes(1);
    });

    it("returns the raced message when create hits clientMessageId unique (P2002)", async () => {
      const existing = createdMessage({ senderUserId: USER_ID });

      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      // Soft-find miss in the aborted tx, then root re-read after P2002.
      messageFindUniqueMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      messageCreateMock.mockRejectedValue({
        code: "P2002",
        meta: { target: ["roomId", "clientMessageId"] },
      });

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "hello once",
          clientMessageId: CLIENT_MESSAGE_ID,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.id).toBe(MESSAGE_ID);
      expect(messageCreateMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(messageFindUniqueMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            roomId_clientMessageId: {
              roomId: ROOM_ID,
              clientMessageId: CLIENT_MESSAGE_ID,
            },
          },
        }),
      );
    });
  });

  describe("quote", () => {
    it("persists quote snapshot in metadata and returns typed quote", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindFirstMock.mockResolvedValue(quotedSourceMessage());
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          metadata: { quote: quoteSnapshot },
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "agreeing with that",
          quote: { messageId: QUOTE_MESSAGE_ID },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.quote).toEqual(quoteSnapshot);
      expect(body.data.parentMessageId).toBeNull();
      expect(body.data.metadata).toEqual({ quote: quoteSnapshot });

      expect(messageFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: QUOTE_MESSAGE_ID, roomId: ROOM_ID, deletedAt: null },
        }),
      );
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parentMessageId: null,
            metadata: { quote: quoteSnapshot },
          }),
        }),
      );
    });

    it("returns 400 when quoted message is missing or in another room", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindFirstMock.mockResolvedValue(null);

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "quoting ghost",
          quote: { messageId: QUOTE_MESSAGE_ID },
        }),
      });

      expect(response.status).toBe(400);
      expect(messageCreateMock).not.toHaveBeenCalled();
    });

    it("keeps quote independent of parentMessageId", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindFirstMock
        .mockResolvedValueOnce({
          id: PARENT_MESSAGE_ID,
          parentMessageId: null,
        })
        .mockResolvedValueOnce(quotedSourceMessage())
        .mockResolvedValueOnce({
          id: PARENT_MESSAGE_ID,
          parentMessageId: null,
        });
      messageFindManyMock.mockResolvedValue([
        { senderCoworkerId: COWORKER_ID, mentionsAsSource: [] },
      ]);
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          parentMessageId: PARENT_MESSAGE_ID,
          metadata: { quote: quoteSnapshot },
          mentionsAsSource: [
            {
              id: MENTION_ID,
              coworkerId: COWORKER_ID,
              sokoBotId: null,
              status: "pending",
              responseMessageId: null,
            },
          ],
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "thread reply that also quotes",
          parentMessageId: PARENT_MESSAGE_ID,
          quote: { messageId: QUOTE_MESSAGE_ID },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.parentMessageId).toBe(PARENT_MESSAGE_ID);
      expect(body.data.quote).toEqual(quoteSnapshot);

      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parentMessageId: PARENT_MESSAGE_ID,
            metadata: { quote: quoteSnapshot },
          }),
        }),
      );
    });

    it("lets a coworker post with a quote snapshot", async () => {
      roomFindFirstMock.mockResolvedValue({
        id: ROOM_ID,
        name: "general",
        kind: "channel",
        organizationId: "org_1",
        userMembers: [],
      });
      messageFindFirstMock.mockResolvedValue(quotedSourceMessage());
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderCoworkerId: COWORKER_ID,
          metadata: { quote: quoteSnapshot },
        }),
      );

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "coworker quoting",
          quote: { messageId: QUOTE_MESSAGE_ID },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.quote).toEqual(quoteSnapshot);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parentMessageId: null,
            metadata: { quote: quoteSnapshot },
          }),
        }),
      );
    });

    it("persists image attachment cue when quoting a message with an image link", async () => {
      roomFindFirstMock.mockResolvedValue(roomWithMembers());
      messageFindFirstMock.mockResolvedValue(
        quotedSourceMessage({ content: imageQuoteContent }),
      );
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          metadata: { quote: imageQuoteSnapshot },
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${ROOM_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "nice shot",
          quote: { messageId: QUOTE_MESSAGE_ID },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.quote).toEqual(imageQuoteSnapshot);
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: { quote: imageQuoteSnapshot },
          }),
        }),
      );
    });
  });
});
