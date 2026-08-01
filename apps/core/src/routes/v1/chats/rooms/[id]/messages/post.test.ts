import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostRoomMessage from "./post";

const {
  roomFindFirstMock,
  roomUpdateMock,
  messageFindFirstMock,
  messageFindManyMock,
  messageCreateMock,
  readStateUpsertMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
  dispatchMock,
  emitChatMentionNotificationsMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCreateMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  dispatchMock: vi.fn(),
  emitChatMentionNotificationsMock: vi.fn(),
  waitUntilMock: vi.fn(),
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
  dispatchChatRoomMention: dispatchMock,
}));

vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: (...args: unknown[]) =>
    emitChatMentionNotificationsMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const MENTION_ID = "550e8400-e29b-41d4-a716-446655440003";
const QUOTE_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440004";
const COWORKER_ID = "coworker_1";
const USER_ID = "user_123";
const ALICE_ID = "user_alice";

const quoteSnapshot = {
  messageId: QUOTE_MESSAGE_ID,
  authorName: "Alice",
  snippet: "Earlier point about launch risk",
};

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
    update: roomUpdateMock,
  },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
    findMany: messageFindManyMock,
    create: messageCreateMock,
  },
  chatRoomReadState: {
    upsert: readStateUpsertMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
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

  mountPostRoomMessage(app as unknown as OpenAPIHonoWithAuth);
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

function roomWithMembers(
  overrides: {
    userMembers?: Array<{
      userId: string;
      user: { name: string };
    }>;
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId: "org_1",
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: overrides.userMembers ?? [],
    coworkerMembers: [
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
  };
}

function createdMessage(
  overrides: Partial<{
    senderUserId: string | null;
    senderCoworkerId: string | null;
    parentMessageId: string | null;
    metadata: Record<string, unknown> | null;
    mentionsAsSource: Array<{
      id: string;
      coworkerId: string;
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
    content: "hello",
    metadata: overrides.metadata ?? null,
    createdAt: new Date("2025-01-02T00:00:00.000Z"),
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
  emitChatMentionNotificationsMock.mockResolvedValue(undefined);
  waitUntilMock.mockImplementation(() => {});
});

describe("POST /chats/rooms/{id}/messages", () => {
  describe("coworker actor", () => {
    it("lets a member coworker post as itself without mention rows", async () => {
      roomFindFirstMock.mockResolvedValue({ id: ROOM_ID });
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

      // Membership is enforced in the room lookup itself.
      expect(roomFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            coworkerMembers: { some: { coworkerId: COWORKER_ID } },
          }),
        }),
      );
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
      expect(waitUntilMock).not.toHaveBeenCalled();
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

      // The thread coworker became a mention target without an @mention;
      // the non-member coworker id from the thread was filtered out.
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: {
              create: [{ coworkerId: COWORKER_ID }],
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
              create: [{ coworkerId: COWORKER_ID }],
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
      // coworker dispatch + human mention emit both scheduled
      expect(waitUntilMock.mock.calls.length).toBeGreaterThanOrEqual(2);
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
          where: { id: QUOTE_MESSAGE_ID, roomId: ROOM_ID },
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
        .mockResolvedValueOnce(quotedSourceMessage());
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
      roomFindFirstMock.mockResolvedValue({ id: ROOM_ID });
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
  });
});
